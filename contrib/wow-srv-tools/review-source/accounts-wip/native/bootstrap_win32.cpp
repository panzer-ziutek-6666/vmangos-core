// Native pre-CLR candidate. This program has NO installation, service-control,
// database, network, shell or arbitrary-path mode. Build/install/run are separate.
#include <windows.h>
#include <sddl.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <algorithm>
#include <cstddef>
#include <cwchar>
#include <memory>
#include <set>
#include <string>
#include <vector>
#include "bootstrap_policy.hpp"
#include "sealed_a141.hpp"
#include "bootstrap_diagnostics.hpp"

namespace {
using a142::require;
// A151: evaluate every original condition once, in its original order.
// LastError is captured only on refusal; it may be stale for a policy check.
void diagnosed_require(bool value, unsigned site) {
    if (!value) { const auto observed = GetLastError(); throw a151::capture(site, observed); }
}
#define require(value) diagnosed_require((value), __LINE__)
struct Handle {
    HANDLE value = nullptr;
    Handle() = default; explicit Handle(HANDLE h) : value(h) {}
    Handle(const Handle&) = delete; Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(other.release()) {}
    Handle& operator=(Handle&& other) noexcept { if (this != &other) { reset(); value = other.release(); } return *this; }
    ~Handle() { reset(); }
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    HANDLE release() { auto h = value; value = nullptr; return h; }
    void reset() { if (valid()) CloseHandle(value); value = nullptr; }
};
struct LocalMemory { HLOCAL value = nullptr; ~LocalMemory() { if (value) LocalFree(value); } };
struct RegKey { HKEY value = nullptr; ~RegKey() { if (value) RegCloseKey(value); } };
struct Find { HANDLE value = INVALID_HANDLE_VALUE; ~Find() { if (value != INVALID_HANDLE_VALUE) FindClose(value); } };
struct Attributes {
    LocalMemory memory;
    SECURITY_ATTRIBUTES value{};
    explicit Attributes(const std::wstring& sddl, bool inherit = false) {
        PSECURITY_DESCRIPTOR sd = nullptr;
        require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &sd, nullptr) != FALSE);
        memory.value = static_cast<HLOCAL>(sd);
        value.nLength = sizeof(value); value.lpSecurityDescriptor = sd; value.bInheritHandle = inherit;
    }
};
void line(const char* text) {
    DWORD written = 0; const auto length = static_cast<DWORD>(std::char_traits<char>::length(text));
    const auto out = GetStdHandle(STD_OUTPUT_HANDLE);
    require(out && out != INVALID_HANDLE_VALUE && WriteFile(out, text, length, &written, nullptr) && written == length);
}
bool equal(const std::wstring& a, const std::wstring& b) { return CompareStringOrdinal(a.c_str(), -1, b.c_str(), -1, TRUE) == CSTR_EQUAL; }
std::wstring joined(const std::wstring& root, std::wstring relative) {
    require(a142::relative_name(relative)); std::replace(relative.begin(), relative.end(), L'/', L'\\'); return root + L"\\" + relative;
}
std::wstring parent(const std::wstring& path) {
    const auto at = path.find_last_of(L'\\'); require(at != std::wstring::npos);
    return at == 2 ? path.substr(0, 3) : path.substr(0, at);
}
std::wstring sid_text(PSID sid) {
    require(sid && IsValidSid(sid)); LPWSTR text = nullptr;
    require(ConvertSidToStringSidW(sid, &text) != FALSE); LocalMemory memory; memory.value = text; return text;
}
std::vector<BYTE> descriptor(HANDLE handle) {
    DWORD count = 0;
    require(!GetKernelObjectSecurity(handle, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, nullptr, 0, &count) && GetLastError() == ERROR_INSUFFICIENT_BUFFER);
    require(count >= SECURITY_DESCRIPTOR_MIN_LENGTH && count <= 65536);
    std::vector<BYTE> bytes(count); DWORD actual = 0;
    require(GetKernelObjectSecurity(handle, 7, bytes.data(), count, &actual) && actual == count && IsValidSecurityDescriptor(bytes.data()));
    return bytes;
}
struct Ace { std::wstring sid; DWORD mask; BYTE flags; BYTE type; };
struct Security {
    std::wstring owner; SECURITY_DESCRIPTOR_CONTROL control = 0; std::vector<Ace> entries;
    explicit Security(const std::vector<BYTE>& bytes) {
        auto sd = const_cast<BYTE*>(bytes.data()); PSID ownerSid = nullptr; BOOL defaulted = FALSE;
        require(IsValidSecurityDescriptor(sd) && GetSecurityDescriptorOwner(sd, &ownerSid, &defaulted)); owner = sid_text(ownerSid);
        DWORD revision = 0; require(GetSecurityDescriptorControl(sd, &control, &revision));
        BOOL present = FALSE; PACL acl = nullptr; require(GetSecurityDescriptorDacl(sd, &present, &acl, &defaulted) && present && acl && IsValidAcl(acl) && acl->AceCount <= 64);
        for (DWORD i = 0; i < acl->AceCount; ++i) {
            LPVOID raw = nullptr; require(GetAce(acl, i, &raw)); auto h = static_cast<ACE_HEADER*>(raw);
            require(h->AceType == ACCESS_ALLOWED_ACE_TYPE || h->AceType == ACCESS_DENIED_ACE_TYPE);
            auto ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
            require(h->AceSize >= offsetof(ACCESS_ALLOWED_ACE, SidStart) + 8);
            auto sid = reinterpret_cast<PSID>(&ace->SidStart); require(IsValidSid(sid));
            require(offsetof(ACCESS_ALLOWED_ACE, SidStart) + GetLengthSid(sid) <= h->AceSize);
            entries.push_back({sid_text(sid), ace->Mask, h->AceFlags, h->AceType});
        }
    }
};
void trusted_descriptor(const std::vector<BYTE>& bytes, bool runtime) {
    Security sd(bytes); a151::AceScope diagnosticOwner(sd.owner.c_str(), 0, 0); require(a142::trusted(sd.owner));
    for (const auto& ace : sd.entries) if (ace.type == ACCESS_ALLOWED_ACE_TYPE)
        { a151::AceScope diagnosticAce(ace.sid.c_str(), ace.mask, ace.flags); require(a142::write_allowed(ace.sid, ace.mask, (ace.flags & INHERIT_ONLY_ACE) != 0, runtime)); }
}
// Exact protected descriptors for installed assets; System ownership is required.
void exact_descriptor(HANDLE handle, DWORD full, DWORD poolMask, bool directory) {
    Security sd(descriptor(handle)); a151::AceScope diagnosticOwner(sd.owner.c_str(), 0, 0); require(sd.owner == L"S-1-5-18" && (sd.control & SE_DACL_PROTECTED));
    std::set<std::wstring> seen;
    require(sd.entries.size() == (poolMask ? 3U : 2U));
    for (const auto& ace : sd.entries) {
        a151::AceScope diagnosticAce(ace.sid.c_str(), ace.mask, ace.flags);
        require(ace.type == ACCESS_ALLOWED_ACE_TYPE &&
            (ace.flags == 0 || (directory && ace.flags == (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE))) && seen.insert(ace.sid).second);
        require((ace.sid == L"S-1-5-18" || ace.sid == L"S-1-5-32-544") ? ace.mask == full : (poolMask && ace.sid == sealed::pool_sid && ace.mask == poolMask));
    }
}
void private_kernel(HANDLE handle) {
    a151::ObjectScope diagnostic(handle == GetCurrentProcess() ? L"PROCESS_SELF" : L"TOKEN_CHECKED");
    Security sd(descriptor(handle)); a151::AceScope diagnosticOwner(sd.owner.c_str(), 0, 0); require(a142::private_kernel_owner_allowed(sd.owner));
    for (const auto& ace : sd.entries) if (ace.type == ACCESS_ALLOWED_ACE_TYPE && !(ace.flags & INHERIT_ONLY_ACE) && ace.mask)
        { a151::AceScope diagnosticAce(ace.sid.c_str(), ace.mask, ace.flags); require(a142::private_kernel_allow_ace(ace.sid, ace.mask, ace.flags)); }
}
struct Hasher {
    BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE hash = nullptr; std::vector<BYTE> object;
    Hasher() {
        try {
            require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0);
            DWORD size = 0, actual = 0;
            require(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&size), sizeof(size), &actual, 0) >= 0 && actual == sizeof(size) && size <= 65536);
            object.resize(size); require(BCryptCreateHash(algorithm, &hash, object.data(), size, nullptr, 0, 0) >= 0);
        } catch (...) { if (hash) BCryptDestroyHash(hash); if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0); throw; }
    }
    ~Hasher() { if (hash) BCryptDestroyHash(hash); if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0); }
    void update(BYTE* bytes, DWORD count) { require(BCryptHashData(hash, bytes, count, 0) >= 0); }
    std::wstring finish() {
        BYTE bytes[32]{}; require(BCryptFinishHash(hash, bytes, sizeof(bytes), 0) >= 0);
        const wchar_t* digits = L"0123456789ABCDEF"; std::wstring result;
        for (auto b : bytes) { result += digits[b >> 4]; result += digits[b & 15]; } return result;
    }
};
std::wstring hash_bytes(std::vector<BYTE> bytes) { Hasher h; h.update(bytes.data(), static_cast<DWORD>(bytes.size())); return h.finish(); }
ULONGLONG filetime(FILETIME value) { return (static_cast<ULONGLONG>(value.dwHighDateTime) << 32) | value.dwLowDateTime; }
ULONGLONG file_size(const BY_HANDLE_FILE_INFORMATION& i) { return (static_cast<ULONGLONG>(i.nFileSizeHigh) << 32) | i.nFileSizeLow; }
std::wstring final_path(HANDLE handle) {
    wchar_t buffer[1024]{}; DWORD length = GetFinalPathNameByHandleW(handle, buffer, 1024, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    require(length > 4 && length < 1024); std::wstring result(buffer, length); require(result.substr(0, 4) == L"\\\\?\\"); return result.substr(4);
}
struct Held {
    Handle handle; std::wstring path; bool directory; std::vector<BYTE> sd; BY_HANDLE_FILE_INFORMATION identity{};
    Held(const std::wstring& name, bool dir) : path(name), directory(dir) {
        a151::ObjectScope diagnostic(path.c_str());
        require(path.size() < 240 && path.substr(0, 3) == L"C:\\" && path.find(L':', 2) == std::wstring::npos);
        handle = Handle(CreateFileW(path.c_str(), READ_CONTROL | SYNCHRONIZE | FILE_READ_ATTRIBUTES | (dir ? 0 : FILE_READ_DATA), dir ? FILE_SHARE_READ | FILE_SHARE_WRITE : FILE_SHARE_READ,
            nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | (dir ? FILE_FLAG_BACKUP_SEMANTICS : 0), nullptr));
        require(handle.valid() && GetFileType(handle.value) == FILE_TYPE_DISK && GetFileInformationByHandle(handle.value, &identity));
        require(!(identity.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && !!(identity.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == dir && equal(final_path(handle.value), path));
        sd = descriptor(handle.value);
    }
    void unchanged() const {
        a151::ObjectScope diagnostic(path.c_str());
        BY_HANDLE_FILE_INFORMATION now{}; require(GetFileInformationByHandle(handle.value, &now));
        require(now.dwVolumeSerialNumber == identity.dwVolumeSerialNumber && now.nFileIndexHigh == identity.nFileIndexHigh && now.nFileIndexLow == identity.nFileIndexLow &&
            now.dwFileAttributes == identity.dwFileAttributes && equal(final_path(handle.value), path) && descriptor(handle.value) == sd);
        if (!directory) require(file_size(now) == file_size(identity) && filetime(now.ftLastWriteTime) == filetime(identity.ftLastWriteTime));
    }
    void pin(const sealed::Pin& value) {
        a151::ObjectScope diagnostic(path.c_str());
        require(!directory && file_size(identity) == value.length && a142::hash_text(value.sha256));
        if (value.modified) require(filetime(identity.ftLastWriteTime) == value.modified);
        LARGE_INTEGER zero{}; require(SetFilePointerEx(handle.value, zero, nullptr, FILE_BEGIN));
        Hasher hash; std::vector<BYTE> buffer(65536); ULONGLONG total = 0;
        for (;;) { DWORD count = 0; require(ReadFile(handle.value, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr)); if (!count) break;
            total += count; require(total <= value.length); hash.update(buffer.data(), count); }
        require(total == value.length && hash.finish() == value.sha256); unchanged();
    }
};
std::vector<BYTE> token_info(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
    DWORD size = 0; require(!GetTokenInformation(token, kind, nullptr, 0, &size) && GetLastError() == ERROR_INSUFFICIENT_BUFFER && size > 0 && size <= 65536);
    std::vector<BYTE> result(size); DWORD actual = 0; require(GetTokenInformation(token, kind, result.data(), size, &actual) && actual <= size); result.resize(actual); return result;
}
std::wstring token_sid(HANDLE token) { auto v = token_info(token, TokenUser); return sid_text(reinterpret_cast<TOKEN_USER*>(v.data())->User.Sid); }
TOKEN_STATISTICS statistics(HANDLE token) { auto v = token_info(token, TokenStatistics); require(v.size() == sizeof(TOKEN_STATISTICS)); return *reinterpret_cast<TOKEN_STATISTICS*>(v.data()); }
bool same_luid(LUID a, LUID b) { return a.LowPart == b.LowPart && a.HighPart == b.HighPart; }
std::vector<BYTE> default_dacl(HANDLE token) {
    auto v = token_info(token, TokenDefaultDacl); auto acl = reinterpret_cast<TOKEN_DEFAULT_DACL*>(v.data())->DefaultDacl;
    if (!acl) return {}; require(IsValidAcl(acl)); const auto bytes = reinterpret_cast<BYTE*>(acl); return {bytes, bytes + acl->AclSize};
}
std::wstring token_state(HANDLE token) {
    std::wstring result = token_sid(token) + hash_bytes(descriptor(token)) + hash_bytes(default_dacl(token));
    auto groupsBytes = token_info(token, TokenGroups); auto groups = reinterpret_cast<TOKEN_GROUPS*>(groupsBytes.data());
    require(groups->GroupCount <= 1024 && offsetof(TOKEN_GROUPS, Groups) + sizeof(SID_AND_ATTRIBUTES) * groups->GroupCount <= groupsBytes.size());
    std::vector<std::wstring> names;
    for (DWORD i = 0; i < groups->GroupCount; ++i) names.push_back(sid_text(groups->Groups[i].Sid) + L":" + std::to_wstring(groups->Groups[i].Attributes));
    std::sort(names.begin(), names.end()); for (const auto& name : names) result += L"/" + name;
    auto privBytes = token_info(token, TokenPrivileges); auto priv = reinterpret_cast<TOKEN_PRIVILEGES*>(privBytes.data());
    require(priv->PrivilegeCount <= 1024 && offsetof(TOKEN_PRIVILEGES, Privileges) + sizeof(LUID_AND_ATTRIBUTES) * priv->PrivilegeCount <= privBytes.size());
    for (DWORD i = 0; i < priv->PrivilegeCount; ++i) result += L"/" + std::to_wstring(priv->Privileges[i].Luid.LowPart) + L":" + std::to_wstring(priv->Privileges[i].Luid.HighPart) + L":" + std::to_wstring(priv->Privileges[i].Attributes);
    result += hash_bytes(token_info(token, TokenSessionId)); return result;
}
void no_thread_token() {
    a151::ObjectScope diagnostic(L"THREAD_TOKEN_CURRENT");
    HANDLE raw = nullptr; const BOOL exists = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &raw); const DWORD error = GetLastError(); Handle token(raw);
    require(!exists && error == ERROR_NO_TOKEN);
}
struct Seal {
    std::vector<std::unique_ptr<Held>> directories, files; RegKey registration; std::set<std::wstring> seen;
    Held& directory(const std::wstring& path, int installed = -1) {
        a151::ObjectScope diagnostic(path.c_str());
        for (auto& held : directories) if (equal(held->path, path)) return *held;
        if (path.size() > 3) directory(parent(path));
        auto held = std::make_unique<Held>(path, true);
        if (installed >= 0) exact_descriptor(held->handle.value, 0x1F01FF, installed == 0 ? 0 : installed == 2 ? 0x1301BF : 0x1200A9, true);
        else trusted_descriptor(held->sd, path.size() >= std::wstring(sealed::runtime_root).size());
        auto& result = *held; directories.push_back(std::move(held)); return result;
    }
    void file(const std::wstring& path, const sealed::Pin& pin, bool installed) {
        a151::ObjectScope diagnostic(path.c_str());
        require(seen.insert(path).second); directory(parent(path)); auto held = std::make_unique<Held>(path, false);
        if (installed) exact_descriptor(held->handle.value, 0x1F01FF, 0x1200A9, false); else trusted_descriptor(held->sd, true);
        held->pin(pin); files.push_back(std::move(held));
    }
    void inventory(const std::wstring& base, std::set<std::wstring>& found, unsigned& count) {
        a151::ObjectScope diagnostic(base.c_str());
        directory(base); WIN32_FIND_DATAW item{}; Find find;
        find.value = FindFirstFileW((base + L"\\*").c_str(), &item); require(find.value != INVALID_HANDLE_VALUE);
        do {
            const std::wstring name = item.cFileName; if (name == L"." || name == L"..") continue;
            require(++count <= 4096 && !(item.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT));
            auto path = base + L"\\" + name;
            if (item.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) inventory(path, found, count);
            else require(found.insert(path).second);
        } while (FindNextFileW(find.value, &item)); require(GetLastError() == ERROR_NO_MORE_FILES);
    }
    void registry() {
        a151::ObjectScope diagnostic(L"REGISTRY32:HKLM\\SOFTWARE\\dotnet\\Setup\\InstalledVersions\\x64:InstallLocation");
        if (!registration.value) require(RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\dotnet\\Setup\\InstalledVersions\\x64", 0, KEY_READ | KEY_WOW64_32KEY, &registration.value) == ERROR_SUCCESS);
        wchar_t location[260]{}; DWORD kind = 0, bytes = sizeof(location);
        require(RegQueryValueExW(registration.value, L"InstallLocation", nullptr, &kind, reinterpret_cast<BYTE*>(location), &bytes) == ERROR_SUCCESS &&
            kind == REG_SZ && bytes >= sizeof(wchar_t) && bytes <= sizeof(location) && bytes % sizeof(wchar_t) == 0 && location[bytes / sizeof(wchar_t) - 1] == 0);
        std::wstring value(location); require((value.size() + 1) * sizeof(wchar_t) == bytes && (equal(value, sealed::runtime_root) || equal(value, std::wstring(sealed::runtime_root) + L"\\")));
        PSECURITY_DESCRIPTOR raw = nullptr;
        require(GetSecurityInfo(reinterpret_cast<HANDLE>(registration.value), SE_REGISTRY_KEY, 7, nullptr, nullptr, nullptr, nullptr, &raw) == ERROR_SUCCESS);
        LocalMemory memory; memory.value = raw; const auto ptr = static_cast<BYTE*>(raw); std::vector<BYTE> sd(ptr, ptr + GetSecurityDescriptorLength(raw));
        Security security(sd); a151::AceScope diagnosticOwner(security.owner.c_str(), 0, 0); require(a142::trusted(security.owner));
        for (const auto& ace : security.entries) if (ace.type == ACCESS_ALLOWED_ACE_TYPE && !(ace.flags & INHERIT_ONLY_ACE) && (ace.mask & 0x500D0006U)) { a151::AceScope diagnosticAce(ace.sid.c_str(), ace.mask, ace.flags); require(a142::trusted(ace.sid)); }
    }
    void runtime_inventory() {
        registry(); std::set<std::wstring> found, expected;
        for (const auto& pin : sealed::runtime_files) expected.insert(joined(sealed::runtime_root, pin.path));
        for (const auto relative : {L"host/fxr", L"shared/Microsoft.NETCore.App"}) {
            auto base = joined(sealed::runtime_root, relative); a151::ObjectScope diagnostic(base.c_str()); directory(base);
            WIN32_FIND_DATAW data{}; Find find; find.value = FindFirstFileW((base + L"\\*").c_str(), &data); require(find.value != INVALID_HANDLE_VALUE);
            unsigned versions = 0;
            do { std::wstring name = data.cFileName; if (name == L"." || name == L"..") continue;
                require(!(data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT));
                if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) { require(name == L"10.0.12"); ++versions; }
            } while (FindNextFileW(find.value, &data)); require(GetLastError() == ERROR_NO_MORE_FILES && versions == 1);
            unsigned count = 0; inventory(base + L"\\10.0.12", found, count);
        }
        require(found == expected);
    }
    void bundle_inventory() {
        for (const auto role : {L"worker", L"client", L"launcher"}) {
            const std::wstring prefix = std::wstring(role) + L"/"; std::set<std::wstring> expected, found;
            for (const auto& pin : sealed::bundle_files) if (std::wstring(pin.path).compare(0, prefix.size(), prefix) == 0) expected.insert(joined(sealed::fixture_root, pin.path));
            const auto base = joined(sealed::fixture_root, role); a151::ObjectScope diagnostic(base.c_str()); WIN32_FIND_DATAW item{}; Find find;
            find.value = FindFirstFileW((base + L"\\*").c_str(), &item); require(find.value != INVALID_HANDLE_VALUE);
            do { const std::wstring name = item.cFileName; if (name == L"." || name == L"..") continue;
                require(!(item.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) && found.insert(base + L"\\" + name).second && found.size() <= 6);
            } while (FindNextFileW(find.value, &item)); require(GetLastError() == ERROR_NO_MORE_FILES && expected.size() == 6 && found == expected);
        }
    }
    void construct() {
        require(a142::root_contract(sealed::fixture_root));
        // Cache the root with its exact policy before descending into any bundle.
        directory(sealed::fixture_root, 1);
        for (auto name : {L"worker", L"client", L"launcher"}) directory(joined(sealed::fixture_root, name), 1);
        directory(joined(sealed::fixture_root, L"system-temp"), 0);
        directory(joined(sealed::fixture_root, L"client-temp"), 2);
        auto bootstrap = joined(sealed::fixture_root, L"bootstrap"); directory(bootstrap, 0);
        WIN32_FIND_DATAW item{}; Find find; find.value = FindFirstFileW((bootstrap + L"\\*").c_str(), &item); require(find.value != INVALID_HANDLE_VALUE);
        unsigned ownCount = 0;
        do { std::wstring name = item.cFileName; if (name == L"." || name == L"..") continue;
            require(name == L"Vmangos.Accounts.Bootstrap.exe" && !(item.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))); ++ownCount;
        } while (FindNextFileW(find.value, &item)); require(GetLastError() == ERROR_NO_MORE_FILES && ownCount == 1);
        const auto diagnosticOwnPath = bootstrap + L"\\Vmangos.Accounts.Bootstrap.exe"; a151::ObjectScope diagnosticOwn(diagnosticOwnPath.c_str());
        auto own = std::make_unique<Held>(bootstrap + L"\\Vmangos.Accounts.Bootstrap.exe", false);
        exact_descriptor(own->handle.value, 0x1F01FF, 0, false); require(file_size(own->identity) > 0 && file_size(own->identity) <= 8388608);
        files.push_back(std::move(own));
        bundle_inventory();
        for (const auto& pin : sealed::bundle_files) file(joined(sealed::fixture_root, pin.path), pin, true);
        file(joined(sealed::fixture_root, sealed::spec.path), sealed::spec, true);
        runtime_inventory();
        for (const auto& pin : sealed::runtime_files) file(joined(sealed::runtime_root, pin.path), pin, false);
        revalidate();
    }
    void revalidate() {
        no_thread_token(); runtime_inventory(); bundle_inventory();
        for (auto& held : directories) held->unchanged();
        // All read handles deny write/delete and remain open throughout execution.
        // Re-hash payloads as well as checking held identities and descriptors.
        for (auto& held : files) held->unchanged();
        for (const auto& pin : sealed::bundle_files) for (auto& held : files) if (equal(held->path, joined(sealed::fixture_root, pin.path))) held->pin(pin);
        for (auto& held : files) if (equal(held->path, joined(sealed::fixture_root, sealed::spec.path))) held->pin(sealed::spec);
        for (const auto& pin : sealed::runtime_files) for (auto& held : files) if (equal(held->path, joined(sealed::runtime_root, pin.path))) held->pin(pin);
    }
};
std::wstring process_image(HANDLE process) { wchar_t buffer[1024]{}; DWORD size = 1024; require(QueryFullProcessImageNameW(process, 0, buffer, &size) && size > 0 && size < 1024); return {buffer, size}; }
std::wstring private_sddl(DWORD full, DWORD poolMask = 0) {
    auto hex = [](DWORD value) {
        std::wstring text = L"0x00000000"; const wchar_t* digits = L"0123456789ABCDEF";
        for (std::size_t i = 10; i > 2;) { text[--i] = digits[value & 15U]; value >>= 4; } return text;
    };
    std::wstring result = L"D:P(A;;" + hex(full) + L";;;SY)(A;;" + hex(full) + L";;;BA)";
    if (poolMask) result += L"(A;;" + hex(poolMask) + L";;;" + sealed::pool_sid + L")"; return result;
}
struct Backend {
    Seal& seal; Handle source, token, job, child, thread, outRead, outWrite, errRead, errWrite, inputRead, inputWrite;
    std::wstring sourceState; TOKEN_STATISTICS sourceStats{}, copiedStats{}; DWORD pid = 0; FILETIME created{};
    std::string output; bool assigned = false, resumed = false, finished = false;
    explicit Backend(Seal& s) : seal(s) {}
    void prepare() {
        HANDLE raw = nullptr; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | READ_CONTROL, &raw)); source = Handle(raw);
        private_kernel(source.value); require(token_sid(source.value) == L"S-1-5-18"); sourceState = token_state(source.value); sourceStats = statistics(source.value);
        Attributes attributes(private_sddl(0xF01FF, 8));
        require(DuplicateTokenEx(source.value, 0x2000B, &attributes.value, SecurityImpersonation, TokenPrimary, &raw)); token = Handle(raw);
        copiedStats = statistics(token.value); require(copiedStats.TokenType == TokenPrimary && !same_luid(copiedStats.TokenId, sourceStats.TokenId) && same_luid(copiedStats.AuthenticationId, sourceStats.AuthenticationId));
        require(token_sid(token.value) == L"S-1-5-18" && default_dacl(token.value) == default_dacl(source.value)); exact_descriptor(token.value, 0xF01FF, 8, false);
        Attributes jobAttributes(private_sddl(0x1F003F)); job = Handle(CreateJobObjectW(&jobAttributes.value, nullptr)); require(job.valid());
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = 4; require(SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)));
    }
    void pipe(Handle& read, Handle& write, bool clearRead) {
        Attributes attributes(private_sddl(0x1F01FF), true); HANDLE r = nullptr, w = nullptr;
        require(CreatePipe(&r, &w, &attributes.value, 4096)); read = Handle(r); write = Handle(w);
        if (clearRead) require(SetHandleInformation(read.value, HANDLE_FLAG_INHERIT, 0));
    }
    void create_suspended() {
        pipe(outRead, outWrite, true); pipe(errRead, errWrite, true); pipe(inputRead, inputWrite, false); inputWrite.reset();
        SIZE_T size = 0; InitializeProcThreadAttributeList(nullptr, 1, 0, &size); require(size > 0 && size <= 65536);
        std::vector<BYTE> storage(size); auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        require(InitializeProcThreadAttributeList(list, 1, 0, &size));
        struct DeleteList { LPPROC_THREAD_ATTRIBUTE_LIST value; ~DeleteList() { DeleteProcThreadAttributeList(value); } } cleanup{list};
        HANDLE handles[] = {inputRead.value, outWrite.value, errWrite.value};
        require(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, sizeof(handles), nullptr, nullptr));
        const std::wstring image = joined(sealed::fixture_root, L"launcher/Vmangos.Accounts.FixtureLauncher.exe");
        auto command = L"\"" + image + L"\" --fixture-launch \"" + sealed::fixture_root + L"\" " + sealed::spec.sha256;
        std::vector<wchar_t> commandLine(command.begin(), command.end()); commandLine.push_back(0);
        std::vector<std::wstring> variables{L"DOTNET_EnableDiagnostics=0", L"PATH=C:\\Windows\\System32", L"SystemDrive=C:", L"SystemRoot=C:\\Windows",
            L"TEMP=" + joined(sealed::fixture_root, L"system-temp"), L"TMP=" + joined(sealed::fixture_root, L"system-temp"), L"windir=C:\\Windows"};
        std::vector<wchar_t> environment; for (const auto& variable : variables) { environment.insert(environment.end(), variable.begin(), variable.end()); environment.push_back(0); } environment.push_back(0);
        STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = inputRead.value; startup.StartupInfo.hStdOutput = outWrite.value; startup.StartupInfo.hStdError = errWrite.value; startup.lpAttributeList = list;
        Attributes processAttributes(private_sddl(0x1FFFFF, 0x101000)), threadAttributes(private_sddl(0x1FFFFF));
        PROCESS_INFORMATION information{};
        require(CreateProcessAsUserW(token.value, image.c_str(), commandLine.data(), &processAttributes.value, &threadAttributes.value, TRUE,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW, environment.data(), parent(image).c_str(), &startup.StartupInfo, &information));
        child = Handle(information.hProcess); thread = Handle(information.hThread); pid = information.dwProcessId;
        outWrite.reset(); errWrite.reset(); inputRead.reset();
    }
    void assign_job() { require(child.valid() && AssignProcessToJobObject(job.value, child.value)); assigned = true; }
    void verify_child() {
        require(assigned && GetProcessId(child.value) == pid && WaitForSingleObject(child.value, 0) == WAIT_TIMEOUT && equal(process_image(child.value), joined(sealed::fixture_root, L"launcher/Vmangos.Accounts.FixtureLauncher.exe")));
        FILETIME exit{}, kernel{}, user{}; require(GetProcessTimes(child.value, &created, &exit, &kernel, &user)); exact_descriptor(child.value, 0x1FFFFF, 0x101000, false);
        exact_descriptor(thread.value, 0x1FFFFF, 0, false);
        HANDLE raw = nullptr; require(OpenProcessToken(child.value, TOKEN_QUERY | READ_CONTROL, &raw)); Handle held(raw);
        auto stats = statistics(held.value); require(stats.TokenType == TokenPrimary && same_luid(stats.TokenId, copiedStats.TokenId) && token_sid(held.value) == L"S-1-5-18");
        exact_descriptor(held.value, 0xF01FF, 8, false); require(default_dacl(held.value) == default_dacl(token.value));
    }
    void revalidate_inputs() {
        seal.revalidate(); no_thread_token(); private_kernel(GetCurrentProcess());
        require(token_state(source.value) == sourceState && same_luid(statistics(source.value).TokenId, sourceStats.TokenId));
    }
    void resume() { require(!resumed && ResumeThread(thread.value) == 1); resumed = true; thread.reset(); }
    void drain(HANDLE pipeHandle, bool errors) {
        for (;;) { DWORD available = 0;
            if (!PeekNamedPipe(pipeHandle, nullptr, 0, nullptr, &available, nullptr)) { require(GetLastError() == ERROR_BROKEN_PIPE); return; }
            if (!available) return; require(!errors && output.size() + available <= 65536);
            char buffer[4096]; DWORD count = 0;
            require(ReadFile(pipeHandle, buffer, (std::min)(available, static_cast<DWORD>(sizeof(buffer))), &count, nullptr) && count > 0);
            output.append(buffer, count);
        }
    }
    DWORD active() const { JOBOBJECT_BASIC_ACCOUNTING_INFORMATION value{}; require(QueryInformationJobObject(job.value, JobObjectBasicAccountingInformation, &value, sizeof(value), nullptr)); return value.ActiveProcesses; }
    void wait_success() {
        const auto start = GetTickCount64();
        for (;;) {
            drain(outRead.value, false); drain(errRead.value, true);
            const DWORD wait = WaitForSingleObject(child.value, 10);
            if (wait == WAIT_OBJECT_0) break; require(wait == WAIT_TIMEOUT && GetTickCount64() - start <= 330000);
        }
        DWORD code = 1; require(GetExitCodeProcess(child.value, &code) && code == 0);
        for (unsigned i = 0; i < 200 && active(); ++i) Sleep(10); require(active() == 0);
        drain(outRead.value, false); drain(errRead.value, true);
        const std::string expected = "A135_LAUNCH_OWNED_CHILDREN=3 SESSIONS=2 SYNTHETIC_DISPATCHES=1 SOURCE_TOKENS_UNCHANGED=True JOB_QUIESCENT=True LIVE_CONNECTIONS=0 IIS_PIPELINE_TESTED=False";
        require(output == expected + "\r\n" || output == expected + "\n");
    }
    void finish() { require(active() == 0 && token_state(source.value) == sourceState); no_thread_token(); finished = true; }
    // Fail-closed: retain every seal until the retained owned process and job
    // are quiescent. Unexpected OS cleanup failure is reported and retention
    // continues; this exceptional wait has no deadline. Never kill by PID/name.
    void abort_owned() noexcept {
        bool announced = false;
        for (;;) {
            bool quiet = true;
            if (job.valid() && assigned) { TerminateJobObject(job.value, 75); JOBOBJECT_BASIC_ACCOUNTING_INFORMATION value{};
                quiet = QueryInformationJobObject(job.value, JobObjectBasicAccountingInformation, &value, sizeof(value), nullptr) && value.ActiveProcesses == 0; }
            if (child.valid()) { if (WaitForSingleObject(child.value, 0) == WAIT_TIMEOUT) TerminateProcess(child.value, 75); quiet = quiet && WaitForSingleObject(child.value, 100) == WAIT_OBJECT_0; }
            if (quiet) return;
            if (!announced) { try { line("A142_CLEANUP_PENDING=True INPUT_HANDLES_RETAINED=True\r\n"); } catch (...) {} announced = true; }
            Sleep(100);
        }
    }
    ~Backend() { if (!finished && child.valid()) abort_owned(); }
};
}
int wmain(int argc, wchar_t** argv) {
    a151::ObjectScope diagnosticEntry(L"PROCESS_ENTRY");
    try {
        static_assert(sizeof(void*) == 8, "x64 required");
        std::vector<std::wstring> args; for (int i = 1; i < argc; ++i) args.emplace_back(argv[i]); const auto mode = a142::mode(args);
        wchar_t machine[256]{}; DWORD size = 256; require(GetComputerNameW(machine, &size) && equal(machine, L"WOW-SRV"));
        no_thread_token(); require(SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)); require(SetDllDirectoryW(L""));
        require(equal(process_image(GetCurrentProcess()), joined(sealed::fixture_root, L"bootstrap/Vmangos.Accounts.Bootstrap.exe"))); private_kernel(GetCurrentProcess());
        HANDLE raw = nullptr; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | READ_CONTROL, &raw)); Handle token(raw);
        require(token_sid(token.value) == L"S-1-5-18"); private_kernel(token.value);
        const auto session = token_info(token.value, TokenSessionId); require(session.size() == sizeof(DWORD) && *reinterpret_cast<const DWORD*>(session.data()) == 0);
        Seal seal; seal.construct();
        if (mode == a142::Mode::Verify) { seal.revalidate(); line("A142_INSTALLED_SEAL_VERIFIED=True CLR_STARTED=False LIVE_CONNECTIONS=0\r\n"); return 0; }
        Backend backend(seal); a142::guarded_launch(backend);
        line("A142_NATIVE_PREENTRY_COMPLETED=True OWN_LAUNCHER_EXIT=0 JOB_QUIESCENT=True LIVE_CONNECTIONS=0 IIS_PIPELINE_TESTED=False\r\n"); return 0;
    } catch (const a151::Refusal& error) {
        try { const auto detail = a151::refusal_line(error); line(detail.c_str()); } catch (...) {}
        try { line(a151::refusal_marker); } catch (...) {}
        return 1;
    } catch (...) { try { line(a151::refusal_marker); } catch (...) {} return 1; }
}
