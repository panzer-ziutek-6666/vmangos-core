#pragma once
#include "Common.h"
enum { LOG_BASIC, LOG_DBERROR, LOG_LVL_ERROR, LOG_LVL_MINIMAL, LOG_LVL_DETAIL, LOG_LVL_DEBUG };
struct TestLog { template<class... T> void Out(int,int,const char*,T...) {} };
extern TestLog gLog;
#define sLog gLog
