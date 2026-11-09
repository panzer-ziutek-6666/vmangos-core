#include "Common.h"
#include "DatabaseEnv.h"
#include "Database/SqlOperations.h"
#include "Database/SqlDelayThread.h"
#include <condition_variable>
TestLog gLog;
int ClientError=0,Attempts=0,Reconnects=0,Rollbacks=0,Deletes=0;
std::atomic<int> ThreadStarts{0},ThreadEnds{0},OutsideContext{0};
thread_local int ContextDepth=0;
bool FailInit=false,Check=true;
int CommitError=0;
std::vector<int> Errors;
std::string Mode;
int mysql_thread_init(){++ThreadStarts;if(FailInit)return 1;++ContextDepth;return 0;}
void mysql_thread_end(){if(ContextDepth<=0)++OutsideContext;else --ContextDepth;++ThreadEnds;}
int mysql_query(MYSQL*,const char* sql){
    if(ContextDepth<=0)++OutsideContext;
    if(std::strcmp(sql,"ROLLBACK")==0){++Rollbacks;ClientError=0;return 0;}
    ++Attempts;
    if(std::strcmp(sql,"COMMIT")==0 && CommitError){ClientError=CommitError;return 1;}
    if(std::strcmp(sql,"START TRANSACTION")==0){ClientError=0;return 0;}
    ClientError=Errors.empty()?0:Errors.front();if(!Errors.empty())Errors.erase(Errors.begin());
    return ClientError?1:0;
}
unsigned int mysql_errno(MYSQL*){return ClientError;}
const char* mysql_error(MYSQL*){return "FAKE_CLIENT_BOUNDARY";}
void mysql_close(MYSQL*){}
MYSQL_RES* mysql_store_result(MYSQL*){static MYSQL_RES r;return &r;}
uint64 mysql_affected_rows(MYSQL*){return 1;}
uint32 mysql_field_count(MYSQL*){return 1;}
void mysql_free_result(MYSQL_RES*){}
MYSQL_FIELD* mysql_fetch_fields(MYSQL_RES*){static MYSQL_FIELD f;return &f;}
int mysql_stmt_execute(MYSQL_STMT*){return mysql_query(nullptr,"PREPARED");}
uint32 mysql_stmt_errno(MYSQL_STMT*){return ClientError;}
const char* mysql_stmt_error(MYSQL_STMT*){return "FAKE_PREPARED_BOUNDARY";}
class ThrowOperation : public SqlOperation { bool unknown;public:explicit ThrowOperation(bool value):unknown(value){} bool Execute(SqlConnection*) override{if(unknown)throw 3;throw std::runtime_error("TEST_EXCEPTION");} };
class PublishOperation : public SqlOperation {
    std::mutex& mutex;std::condition_variable& condition;int& phase;
public:PublishOperation(std::mutex& m,std::condition_variable& c,int& p):mutex(m),condition(c),phase(p){}
    bool Execute(SqlConnection*) override{
        if(ContextDepth<=0)++OutsideContext;
        std::unique_lock<std::mutex> lock(mutex);phase=1;condition.notify_all();
        if(!condition.wait_for(lock,std::chrono::seconds(2),[&](){return phase==2;}))throw std::runtime_error("TEST_PUBLISH_TIMEOUT");
        return true;
    }
};
int Scenario(){
    bool query=Mode.find("query-")==0,prepared=Mode.find("prepared-")==0;
    if(query||prepared){
        mysql_thread_init();MySQLConnection conn;bool okay;
        if(Mode=="query-success")Errors={0};
        else if(Mode=="query-1053-first")Errors={1053};
        else if(Mode=="query-1053-last"||Mode=="query-reconnect-success"||Mode=="query-retry-exhausted")Errors={2006,Mode=="query-1053-last"?1053:Mode=="query-retry-exhausted"?2006:0};
        else if(Mode.find("duplicate")!=std::string::npos)Errors={1062};
        else if(Mode.find("deadlock")!=std::string::npos)Errors={1213};
        else Errors={1053};
        if(prepared){MySqlPreparedStatement statement;okay=statement.execute();}
        else{MYSQL_RES* r=nullptr;MYSQL_FIELD* f=nullptr;uint64 rows=0;uint32 fields=0;okay=conn._Query("SELECT_TEST",&r,&f,&rows,&fields);}
        bool success=Mode=="query-success"||Mode=="query-reconnect-success";
        bool fatal=Mode.find("1053")!=std::string::npos||Mode=="query-retry-exhausted";
        int retries=Mode=="query-1053-last"||Mode=="query-reconnect-success"||Mode=="query-retry-exhausted"?1:0;
        Check=Check && okay==success && SqlOutcome::Failed()==fatal && Reconnects==retries && Attempts==1+retries;
        mysql_thread_end();return SqlOutcome::CoreExit(0);
    }
    mysql_thread_init();Database db;auto conn=new MySQLConnection;auto worker=new SqlDelayThread(&db,conn);
    db.onEmpty=[&](){worker->Stop();};
    bool stopBefore=Mode=="stop-before-loop"||Mode=="init-failed"||Mode=="late-after-run";
    if(Mode=="worker-1053"||Mode=="worker-1053-stop")Errors={1053};
    if(Mode=="handled-duplicate")Errors={1062,0,0};
    if(Mode=="handled-deadlock")Errors={1213,0,0};
    if(Mode=="write-lost-no-replay")Errors={2006};
    if(Mode=="commit-1053"||Mode=="commit-deadlock"){
        CommitError=Mode=="commit-1053"?1053:1213;auto transaction=new SqlTransaction;transaction->m_queue.push_back(new SqlPlainRequest("TX_WRITE"));db.Add(transaction);
    }else if(Mode=="worker-exception"||Mode=="worker-unknown")db.Add(new ThrowOperation(Mode=="worker-unknown"));
    else if(Mode!="late-during-drain")db.Add(new SqlPlainRequest("WRITE"));
    std::mutex mutex;std::condition_variable condition;int phase=0;
    if(Mode=="late-during-drain")db.Add(new PublishOperation(mutex,condition,phase));
    if(!stopBefore && Mode!="late-during-drain"){db.Add(new SqlPlainRequest("LATER_GLOBAL"));worker->addSerialOperation(new SqlPlainRequest("LATER_SERIAL"));}
    if(stopBefore||Mode=="late-during-drain")worker->Stop();
    if(Mode=="init-failed")FailInit=true;
    std::thread thread([&](){worker->run();});
    if(Mode=="late-during-drain"){
        std::unique_lock<std::mutex> lock(mutex);
        if(!condition.wait_for(lock,std::chrono::seconds(2),[&](){return phase==1;}))Check=false;
        db.Add(new SqlPlainRequest("LATE_GLOBAL"));worker->addSerialOperation(new SqlPlainRequest("LATE_SERIAL"));phase=2;condition.notify_all();
    }
    thread.join();FailInit=false;
    if(Mode=="late-after-run")db.Add(new SqlPlainRequest("TOO_LATE"));
    delete worker;
    Check=Check && ContextDepth==1;
    bool fatal=Mode=="worker-1053"||Mode=="worker-1053-stop"||Mode=="write-lost-no-replay"||Mode=="commit-1053"||Mode=="worker-exception"||Mode=="worker-unknown"||Mode=="init-failed"||Mode=="late-after-run";
    Check=Check && SqlOutcome::Failed()==fatal;
    if(Mode=="stop-before-loop")Check=Check && Attempts==1 && Deletes==1;
    if(Mode=="late-during-drain")Check=Check && Attempts==2 && Deletes==3;
    if(Mode=="late-after-run")Check=Check && Attempts==1 && SqlOutcome::Get().abandonedOperations==1;
    if(Mode=="init-failed")Check=Check && Attempts==0 && SqlOutcome::Get().abandonedOperations==1 && ThreadEnds==0;
    if(Mode=="handled-duplicate"||Mode=="handled-deadlock")Check=Check && Attempts==3 && SqlOutcome::Get().abandonedOperations==0 && SqlOutcome::Get().failedOperations==1;
    if(Mode=="worker-1053"||Mode=="worker-1053-stop"||Mode=="write-lost-no-replay")Check=Check && Attempts==1 && Reconnects==0 && SqlOutcome::Get().abandonedOperations==2;
    if(Mode=="commit-1053"||Mode=="commit-deadlock")Check=Check && Rollbacks==1;
    mysql_thread_end();return SqlOutcome::CoreExit(0);
}
SERVICE_STATUS LastStatus{};
BOOL WINAPI QA_Status(SERVICE_STATUS_HANDLE,LPSERVICE_STATUS s){LastStatus=*s;return TRUE;}
SERVICE_STATUS_HANDLE WINAPI QA_Register(LPCSTR,LPHANDLER_FUNCTION){return reinterpret_cast<SERVICE_STATUS_HANDLE>(1);}
BOOL WINAPI QA_Directory(LPCSTR){return TRUE;}
BOOL WINAPI QA_Dispatch(const SERVICE_TABLE_ENTRYA* e){e[0].lpServiceProc(0,nullptr);return TRUE;}
char serviceName[]="ISOLATED-NEVER-INSTALLED",serviceLongName[]="ISOLATED-NEVER-INSTALLED",serviceDescription[]="No real SCM calls";
volatile int m_ServiceStatus=-1;
int QA_CoreMain(int,char**);
#define main QA_CoreMain
#define SetServiceStatus QA_Status
#undef RegisterServiceCtrlHandler
#define RegisterServiceCtrlHandler QA_Register
#undef SetCurrentDirectory
#define SetCurrentDirectory QA_Directory
#undef StartServiceCtrlDispatcher
#define StartServiceCtrlDispatcher QA_Dispatch
#include "Actual.ServiceWin32.cpp"
#undef main
int QA_CoreMain(int,char**){if(Mode=="worker-1053-stop"||Mode=="stop-before-loop")ServiceControlHandler(SERVICE_CONTROL_STOP);return Scenario();}
int main(int argc,char** argv){
    if(argc!=2)return 99;Mode=argv[1];bool dispatch=WinServiceRun();
    Check=Check && OutsideContext==0 && ContextDepth==0 && ThreadStarts==ThreadEnds+(Mode=="init-failed"?1:0);
    int expected=SqlOutcome::Failed()?1:0;
    Check=Check && serviceMainResult==expected && LastStatus.dwCurrentState==SERVICE_STOPPED && LastStatus.dwServiceSpecificExitCode==expected && LastStatus.dwWin32ExitCode==(expected?1066:0) && dispatch==(expected==0);
    std::printf("{\"Case\":\"%s\",\"Pass\":%s,\"CoreServiceExit\":%d,\"Win32Exit\":%lu,\"SpecificExit\":%lu,\"Fatal\":%s,\"Attempts\":%d,\"Reconnects\":%d,\"OutsideContext\":%d,\"ThreadStarts\":%d,\"ThreadEnds\":%d,\"Abandoned\":%llu,\"FailedOperations\":%llu}\n",Mode.c_str(),Check?"true":"false",serviceMainResult,LastStatus.dwWin32ExitCode,LastStatus.dwServiceSpecificExitCode,SqlOutcome::Failed()?"true":"false",Attempts,Reconnects,OutsideContext.load(),ThreadStarts.load(),ThreadEnds.load(),static_cast<unsigned long long>(SqlOutcome::Get().abandonedOperations.load()),static_cast<unsigned long long>(SqlOutcome::Get().failedOperations.load()));
    return Check?expected:88;
}
