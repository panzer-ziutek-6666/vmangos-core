#include "bootstrap_policy.hpp"
#include "bootstrap_diagnostics.hpp"
#include <iostream>
#include <algorithm>
#ifdef _WIN32
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#endif
using namespace a142;
static int checks = 0;
static void check(bool value) { ++checks; require(value); }
struct FaultBackend {
    int fail, calls = 0, resume_count = 0, abort_count = 0; bool created = false;
    std::vector<int> trace;
    explicit FaultBackend(int at) : fail(at) {}
    void step(int value) { trace.push_back(value); if (++calls == fail) throw std::runtime_error("injected"); }
    void prepare() { step(1); }
    void create_suspended() { created = true; step(2); }
    void assign_job() { require(created); step(3); }
    void verify_child() { step(4); }
    void revalidate_inputs() { step(5); }
    void resume() { step(6); ++resume_count; }
    void wait_success() { step(7); }
    void finish() { step(8); }
    void abort_owned() { ++abort_count; }
};
int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--diagnostic-contract") {
            // Synthetic reproduction of the captured A153-R1 refusal. This
            // executes the formatter, not bootstrap_win32 or a Windows API.
            const a151::Refusal observed{115, 0, "PROCESS_SELF", "S-1-3-4", 131072, 0};
#ifdef _WIN32
            // Preserve the raw CRLF emitted by Win32 WriteFile; CRT text mode
            // would otherwise translate its LF a second time into CRCRLF.
            if (_setmode(_fileno(stdout), _O_BINARY) == -1) return 2;
#endif
            std::cout << a151::refusal_output(observed);
            return 0;
        }
        check(argc == 2 && std::string(argv[1]) == "--policy-tests");
        const std::wstring root = L"C:\\VMANGOS-Accounts-Fixture-A139-1f07880aecf4453d8e77d99dc8fa3f7d";
        check(root_contract(root));
        for (auto bad : {L"", L"C:VMANGOS-Accounts-Fixture-A139-1f07880aecf4453d8e77d99dc8fa3f7d",
             L"C:\\GRY\\wow\\dev\\fixture-accounts-windows-A135-1f07880aecf4453d8e77d99dc8fa3f7d",
             L"C:\\VMANGOS-Accounts-Fixture-A139-00000000000000000000000000000000"}) check(!root_contract(bad));
        for (std::size_t n = 0; n < root.size(); ++n) {
            auto bad = root; bad[n] = L'!'; check(!root_contract(bad));
        }
        check(relative_name(L"worker/Vmangos.Accounts.Worker.exe"));
        for (auto bad : {L"../worker/a", L"/worker/a", L"worker//a", L"worker/a/", L"worker/a:stream",
             L"worker/a.", L"worker/NUL.txt", L"worker/COM1", L"worker/a\\b", L"a b", L"worker/..", L"a\n"}) check(!relative_name(bad));
        check(hash_text(std::wstring(64, L'A')));
        for (auto bad : {std::wstring(63, L'A'), std::wstring(65, L'A'), std::wstring(64, L'g'), std::wstring(64, L'a')}) check(!hash_text(bad));
        for (auto sid : {L"S-1-1-0", L"S-1-5-11", L"S-1-5-32-545", L"S-1-5-82-1"}) {
            for (unsigned bit = 0; bit < 32; ++bit) {
                auto mask = std::uint32_t(1) << bit;
                for (bool runtime : {false, true}) {
                    check(write_allowed(sid, mask, false, runtime) == !(mask & (runtime ? 0x500D0156U : 0x500D0152U)));
                    check(write_allowed(sid, mask, true, runtime));
                }
            }
        }
        check(write_allowed(L"S-1-5-18", 0xFFFFFFFFU, false, true));
        check(write_allowed(L"S-1-5-32-544", 0xFFFFFFFFU, false, true));
        check(write_allowed(L"S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464", 0xFFFFFFFFU, false, true));
        check(private_kernel_owner_allowed(L"S-1-5-18"));
        check(private_kernel_owner_allowed(L"S-1-5-32-544"));
        check(private_kernel_allow_ace(L"S-1-5-18", 0xFFFFFFFFU, 0));
        check(private_kernel_allow_ace(L"S-1-5-32-544", 0xFFFFFFFFU, 0));
        check(private_kernel_allow_ace(L"S-1-3-4", 131072, 0));
        check(!private_kernel_allow_ace(L"S-1-3-4", 0, 0));
        for (auto sid : {L"S-1-3-4", L"S-1-1-0", L"S-1-5-11", L"S-1-5-32-545", L"S-1-5-82-1"}) {
            check(!private_kernel_owner_allowed(sid));
            if (std::wstring(sid) != L"S-1-3-4") check(!private_kernel_allow_ace(sid, 131072, 0));
        }
        for (unsigned bit = 0; bit < 32; ++bit) {
            const auto right = std::uint32_t(1) << bit;
            if (right != 131072U) {
                // In particular reject WRITE_DAC, WRITE_OWNER and MAXIMUM_ALLOWED.
                check(!private_kernel_allow_ace(L"S-1-3-4", right, 0));
                check(!private_kernel_allow_ace(L"S-1-3-4", 131072U | right, 0));
            }
        }
        for (unsigned flags = 1; flags < 256; ++flags)
            check(!private_kernel_allow_ace(L"S-1-3-4", 131072, static_cast<std::uint8_t>(flags)));
        check(mode({L"--verify-installed"}) == Mode::Verify); check(mode({L"--fixture-launch"}) == Mode::Launch);
        for (auto args : {std::vector<std::wstring>{}, {L"--fixture-launch", L"extra"}, {L"--launch"}, {L"--install"}}) {
            bool refused = false; try { (void)mode(args); } catch (...) { refused = true; } check(refused);
        }
        FaultBackend good(0); guarded_launch(good);
        check(good.trace == std::vector<int>({1,2,3,4,5,6,7,5,8}) && good.resume_count == 1 && good.abort_count == 0);
        for (int fail = 1; fail <= 9; ++fail) {
            FaultBackend bad(fail); bool refused = false;
            try { guarded_launch(bad); } catch (...) { refused = true; }
            check(refused && bad.abort_count == 1 && bad.resume_count == (fail > 6 ? 1 : 0));
            check(bad.trace.size() == static_cast<std::size_t>(fail));
        }
        std::cout << "A142_NATIVE_POLICY_TESTS=" << checks << " FAILED=0 LIVE_CONNECTIONS=0 WINDOWS_NATIVE=NOT_RUN\n";
        return 0;
    } catch (...) { std::cout << "A142_NATIVE_POLICY_TESTS_FAILED=True\n"; return 1; }
}
