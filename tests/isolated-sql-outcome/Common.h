#pragma once
#include <string>
#include <vector>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <chrono>
#include <functional>
#include <stdexcept>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <Windows.h>
#include <winsvc.h>
using uint32 = std::uint32_t;
using uint64 = std::uint64_t;
#define ASSERT(x) do { if (!(x)) throw std::runtime_error("ASSERT"); } while (false)
