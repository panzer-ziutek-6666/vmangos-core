/*
 * Copyright (C) 2005-2011 MaNGOS <http://getmangos.com/>
 * Copyright (C) 2009-2011 MaNGOSZero <https://github.com/mangos/zero>
 * Copyright (C) 2011-2016 Nostalrius <https://nostalrius.org>
 * Copyright (C) 2016-2017 Elysium Project <https://github.com/elysium-project>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

#include "Log.h"
#include "Database/SqlDelayThread.h"
#include "Database/SqlOperations.h"
#include "DatabaseEnv.h"
#include "Database/SqlOutcome.h"
#include <exception>
#include <memory>
#include <stdexcept>

namespace {
// Only this worker owns this context. Cleanup runs on the same thread even if
// initialization/drain throws; a failed initialization never calls thread_end.
class WorkerMySQLContext {
public:
    WorkerMySQLContext() : initialized(mysql_thread_init() == 0) {}
    ~WorkerMySQLContext() { if (initialized) mysql_thread_end(); }
    bool const initialized;
    WorkerMySQLContext(WorkerMySQLContext const&) = delete;
    WorkerMySQLContext& operator=(WorkerMySQLContext const&) = delete;
};
}

SqlDelayThread::SqlDelayThread(Database* db, SqlConnection* conn)
    : m_dbEngine(db), m_dbConnection(conn), m_running(true)
{
}

SqlDelayThread::~SqlDelayThread()
{
    // The worker's client context has ended. Never execute late SQL on the
    // owner's thread or end a context owned by that caller. Report late work.
    DiscardRequests();
    delete m_dbConnection;
}

void SqlDelayThread::addSerialOperation(SqlOperation *op)
{
    m_serialDelayQueue.add(op);
}

bool SqlDelayThread::HasAsyncQuery()
{
    return !m_serialDelayQueue.empty_unsafe();
}

void SqlDelayThread::run()
{
    try
    {
        WorkerMySQLContext context;
        if (!context.initialized)
            throw std::runtime_error("MYSQL_THREAD_INIT_FAILED");
        auto lastAliveCheck = Clock::now();
        auto interval = std::chrono::milliseconds(m_dbEngine->GetPingIntervalMs());
        while (m_running)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            ProcessRequests();
            if (SqlOutcome::Failed()) { m_running = false; break; }
            if ((lastAliveCheck + interval) <= Clock::now())
            {
                m_dbEngine->Ping();
                m_dbConnection->Query("SELECT 1");
                lastAliveCheck = Clock::now();
            }
        }
        // Includes STOP before loop entry and work published during the stop.
        // Must finish before context destruction/mysql_thread_end on this thread.
        ProcessRequests();
    }
    catch (std::exception const&)
    {
        SqlOutcome::OperationFailed();
        sLog.Out(LOG_BASIC, LOG_LVL_ERROR, "SQL_WORKER_EXCEPTION: shutdown required; no replay.");
    }
    catch (...)
    {
        SqlOutcome::OperationFailed();
        sLog.Out(LOG_BASIC, LOG_LVL_ERROR, "SQL_WORKER_UNKNOWN_EXCEPTION: shutdown required; no replay.");
    }
    // Exceptional/init-failure paths and post-drain arrivals never execute SQL.
    // The destructor repeats this discard-only check for still later arrivals.
    DiscardRequests();
}
void SqlDelayThread::Stop()
{
    m_running = false;
}

void SqlDelayThread::ProcessRequests()
{
    SqlOperation* s = nullptr;
    while (m_dbEngine->NextDelayedOperation(s))
    {
        ExecuteOrDiscard(s);
    }

    // Process any serial operations for this worker
    while (m_serialDelayQueue.next(s))
    {
        ExecuteOrDiscard(s);
    }
}

void SqlDelayThread::ExecuteOrDiscard(SqlOperation* operation)
{
    std::unique_ptr<SqlOperation> owner(operation);
    if (SqlOutcome::Failed()) { SqlOutcome::Abandon(); return; }
    try
    {
        if (!operation->Execute(m_dbConnection))
        {
            SqlOutcome::OperationFailed(false);
            sLog.Out(LOG_BASIC, LOG_LVL_ERROR, "SQL_OPERATION_REJECTED: no replay; remaining queue continues unless a fatal SQL outcome was classified.");
        }
    }
    catch (std::exception const&)
    {
        SqlOutcome::OperationFailed();
        sLog.Out(LOG_BASIC, LOG_LVL_ERROR, "SQL_OPERATION_EXCEPTION: result unconfirmed; remaining queue abandoned, no replay.");
    }
    catch (...)
    {
        SqlOutcome::OperationFailed();
        sLog.Out(LOG_BASIC, LOG_LVL_ERROR, "SQL_OPERATION_UNKNOWN_EXCEPTION: result unconfirmed; remaining queue abandoned, no replay.");
    }
}

void SqlDelayThread::DiscardRequests()
{
    SqlOperation* operation = nullptr;
    while (m_dbEngine->NextDelayedOperation(operation))
    {
        std::unique_ptr<SqlOperation> owner(operation);
        SqlOutcome::Abandon();
    }
    while (m_serialDelayQueue.next(operation))
    {
        std::unique_ptr<SqlOperation> owner(operation);
        SqlOutcome::Abandon();
    }
}
