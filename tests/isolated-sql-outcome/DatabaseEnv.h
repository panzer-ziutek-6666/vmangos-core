#pragma once
#include "Common.h"
#include "Log.h"
#include "Database/SqlOutcome.h"
#include <errmsg.h>
#include <mysqld_error.h>
using Clock = std::chrono::steady_clock;
namespace WorldTimer { inline uint32 getMSTime() { return 1; } inline uint32 getMSTimeDiff(uint32,uint32) { return 0; } }
#define LOG_FILTER_SQL_TEXT 0
#define DEBUG_FILTER_LOG(...) do {} while(false)
struct MYSQL {}; struct MYSQL_RES {}; struct MYSQL_FIELD {}; struct MYSQL_STMT {};
extern int ClientError, Attempts, Reconnects, Rollbacks, Deletes;
extern std::atomic<int> ThreadStarts,ThreadEnds,OutsideContext;
int mysql_query(MYSQL*, const char*);
unsigned int mysql_errno(MYSQL*);
const char* mysql_error(MYSQL*);
void mysql_close(MYSQL*);
MYSQL_RES* mysql_store_result(MYSQL*);
uint64 mysql_affected_rows(MYSQL*);
uint32 mysql_field_count(MYSQL*);
void mysql_free_result(MYSQL_RES*);
MYSQL_FIELD* mysql_fetch_fields(MYSQL_RES*);
int mysql_stmt_execute(MYSQL_STMT*);
uint32 mysql_stmt_errno(MYSQL_STMT*);
const char* mysql_stmt_error(MYSQL_STMT*);
int mysql_thread_init(); void mysql_thread_end();
class SqlOperation;
class SqlConnection {
public:
    virtual ~SqlConnection() = default;
    virtual bool Execute(std::string const&) = 0;
    virtual bool BeginTransaction() = 0;
    virtual bool CommitTransaction() = 0;
    virtual bool RollbackTransaction() = 0;
    std::unique_ptr<int> Query(std::string const&) { return {}; }
    class Lock { public: explicit Lock(SqlConnection*) {} };
};
class MySQLConnection : public SqlConnection {
    MYSQL value; MYSQL* mMysql = &value;
public:
    bool Execute(std::string const&) override;
#ifdef R2_BASELINE
    bool HandleMySQLError(uint32);
#else
    bool HandleMySQLError(uint32,bool=true);
#endif
    bool Reconnect() { ++Reconnects;mMysql=&value;return true; }
    bool _Query(std::string const&,MYSQL_RES**,MYSQL_FIELD**,uint64*,uint32*,bool=false);
    bool _TransactionCmd(std::string const&);
    bool BeginTransaction() override; bool CommitTransaction() override; bool RollbackTransaction() override;
};
class MySqlPreparedStatement {
    MYSQL_STMT value; MYSQL_STMT* m_stmt=&value; std::string m_szFmt="TEST_PREPARED";
    bool isPrepared() { return true; }
public: bool execute();
};
class Database {
    std::mutex mutex;
public:
    std::deque<SqlOperation*> queue;
    std::function<void()> onEmpty;
    int GetPingIntervalMs() { return 100000; }
    void Ping() {}
    void Add(SqlOperation* op) { std::lock_guard<std::mutex> lock(mutex);queue.push_back(op); }
    bool NextDelayedOperation(SqlOperation*& out) {
        { std::lock_guard<std::mutex> lock(mutex);if(!queue.empty()){out=queue.front();queue.pop_front();return true;} }
        if(onEmpty) onEmpty(); return false;
    }
};
