#pragma once
#include <string>
#include <cstdint>
namespace a151 {
struct Context { const wchar_t* object = nullptr; const wchar_t* sid = nullptr; std::uint32_t mask = 0, flags = 0; };
inline Context current{}; // Native verification uses one calling thread.
struct ObjectScope {
    Context previous;
    explicit ObjectScope(const wchar_t* object) : previous(current) { current = Context{object, nullptr, 0, 0}; }
    ~ObjectScope() { current = previous; }
};
struct AceScope {
    Context previous;
    AceScope(const wchar_t* sid, std::uint32_t mask, std::uint32_t flags) : previous(current) {
        current.sid = sid; current.mask = mask; current.flags = flags;
    }
    ~AceScope() { current = previous; }
};
inline std::string safe_ascii(const wchar_t* text) {
    if (!text) return "UNAVAILABLE";
    std::string value;
    for (unsigned i = 0; text[i] && i < 240; ++i) {
        const auto c = text[i]; value += (c >= 32 && c <= 126 && c != L'[' && c != L']') ? static_cast<char>(c) : '?';
    }
    return value;
}
struct Refusal {
    unsigned line = 0; unsigned long observed_win32 = 0;
    std::string object = "UNAVAILABLE", sid = "UNAVAILABLE"; std::uint32_t mask = 0, flags = 0;
};
inline Refusal capture(unsigned site, unsigned long code) {
    return Refusal{site, code, safe_ascii(current.object), safe_ascii(current.sid), current.mask, current.flags};
}
inline std::string refusal_line(const Refusal& e) {
    return "A151_NATIVE_REFUSAL SOURCE=bootstrap_win32.cpp LINE=" + std::to_string(e.line) +
        " WIN32_OBSERVED=" + std::to_string(e.observed_win32) + " OBJECT=[" + e.object + "] SID=" + e.sid +
        " MASK=" + std::to_string(e.mask) + " FLAGS=" + std::to_string(e.flags) + " LIVE_CONNECTIONS=0\r\n";
}
inline constexpr const char* refusal_marker = "A142_NATIVE_BOOTSTRAP_REFUSED=True LIVE_CONNECTIONS=0\r\n";
// Both the Win32 emitter and the portable contract test use these same parts.
inline std::string refusal_output(const Refusal& e) {
    return refusal_line(e) + refusal_marker;
}
}
