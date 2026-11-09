#ifndef WOW_SQL_OUTCOME_H
#define WOW_SQL_OUTCOME_H
#include <atomic>
#include <cstdint>
// Process lifetime latch. No SQL text, replay, or durable queue is stored here.
namespace SqlOutcome {
struct State {
    std::atomic<bool> failed{false};
    std::atomic<std::uint64_t> failedOperations{0}, abandonedOperations{0};
};
inline State& Get() { static State state; return state; }
inline bool Failed() { return Get().failed.load(); }
inline void MarkFailure() { Get().failed.store(true); }
// A rejected statement (e.g. duplicate/deadlock) is observable without making
// the entire process fatal. Connection loss/shutdown and exceptions latch failure.
inline void OperationFailed(bool fatal = true) { if (fatal) MarkFailure(); ++Get().failedOperations; }
inline void Abandon() { MarkFailure(); ++Get().abandonedOperations; }
inline int CoreExit(int requested) { return Failed() ? 1 : requested; }
inline int ServiceExit(int requested, bool explicitStop) {
    int result = CoreExit(requested);
    return explicitStop && result == 2 ? 0 : result;
}
}
#endif
