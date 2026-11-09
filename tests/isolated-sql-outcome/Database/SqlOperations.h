#pragma once
#include "DatabaseEnv.h"
class SqlOperation { public: virtual ~SqlOperation() { ++Deletes; } virtual bool Execute(SqlConnection*) = 0; };
class SqlPlainRequest : public SqlOperation {
    std::string m_sql;
public:
    explicit SqlPlainRequest(std::string sql):m_sql(std::move(sql)) {}
    bool Execute(SqlConnection*) override;
};
class SqlTransaction : public SqlOperation {
public:
    std::deque<SqlOperation*> m_queue;
    ~SqlTransaction() override;
    bool Execute(SqlConnection*) override;
};
#define LOCK_DB_CONN(conn) SqlConnection::Lock guard(conn)
