#pragma once
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace a142 {
inline void require(bool value) { if (!value) throw std::runtime_error("A142_REFUSED"); }
// A154: OWNER RIGHTS is a special owner-relative SID, not an additional user.
// It is accepted only after the object's owner passed the SY/BA check below,
// and only for the exact READ_CONTROL-only ACE observed in A153-R1.
// This does not write a descriptor or permit WRITE_DAC, token or process access.
inline bool private_kernel_owner_allowed(const std::wstring& sid) {
    return sid == L"S-1-5-18" || sid == L"S-1-5-32-544";
}
inline bool private_kernel_allow_ace(const std::wstring& sid, std::uint32_t mask, std::uint8_t flags) {
    return private_kernel_owner_allowed(sid) ||
        (sid == L"S-1-3-4" && mask == 0x00020000U && flags == 0);
}
inline bool trusted(const std::wstring& sid) {
    return sid == L"S-1-5-18" || sid == L"S-1-5-32-544" ||
        sid == L"S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
}
inline bool write_allowed(const std::wstring& sid, std::uint32_t mask, bool inherit_only, bool runtime) {
    return inherit_only || !(mask & (runtime ? 0x500D0156U : 0x500D0152U)) || trusted(sid);
}
inline bool root_contract(const std::wstring& path) {
    const std::wstring prefix = L"C:\\VMANGOS-Accounts-Fixture-A139-";
    if (path.size() != prefix.size() + 32 || path.compare(0, prefix.size(), prefix) != 0) return false;
    bool nonzero = false;
    for (auto c : path.substr(prefix.size())) {
        if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'))) return false;
        nonzero = nonzero || c != L'0';
    }
    return nonzero;
}
inline bool relative_name(const std::wstring& path) {
    if (path.empty() || path.size() >= 220) return false;
    std::size_t start = 0;
    while (start < path.size()) {
        auto end = path.find(L'/', start); if (end == std::wstring::npos) end = path.size();
        auto part = path.substr(start, end - start);
        if (part.empty() || part == L"." || part == L".." || part.back() == L'.') return false;
        for (auto c : part) if (!((c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
            (c >= L'0' && c <= L'9') || c == L'_' || c == L'-' || c == L'.')) return false;
        std::wstring stem = part.substr(0, part.find(L'.'));
        for (auto& c : stem) if (c >= L'a' && c <= L'z') c = static_cast<wchar_t>(c - 32);
        if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
            (stem.size() == 4 && (stem.substr(0, 3) == L"COM" || stem.substr(0, 3) == L"LPT") &&
             stem[3] >= L'0' && stem[3] <= L'9')) return false;
        if (end == path.size()) return true;
        start = end + 1;
    }
    return false;
}
inline bool hash_text(const std::wstring& value) {
    if (value.size() != 64) return false;
    for (auto c : value) if (!((c >= L'0' && c <= L'9') || (c >= L'A' && c <= L'F'))) return false;
    return true;
}
enum class Mode { Verify, Launch };
inline Mode mode(const std::vector<std::wstring>& args) {
    require(args.size() == 1);
    if (args[0] == L"--verify-installed") return Mode::Verify;
    require(args[0] == L"--fixture-launch"); return Mode::Launch;
}
// Used by the native backend and the fault-injection tests. No resume before
// a private suspended child, own job, token/image checks and final input check.
template<class Backend> void guarded_launch(Backend& b) {
    try {
        b.prepare(); b.create_suspended(); b.assign_job(); b.verify_child();
        b.revalidate_inputs(); b.resume(); b.wait_success(); b.revalidate_inputs(); b.finish();
    } catch (...) { b.abort_owned(); throw; }
}
}
