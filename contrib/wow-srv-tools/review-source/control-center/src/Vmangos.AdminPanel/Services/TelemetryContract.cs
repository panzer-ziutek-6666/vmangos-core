#nullable disable
using System;
using System.Text.RegularExpressions;

namespace Vmangos.AdminPanel.Telemetry
{
    // Schema 1 contains aggregates only. It never contains names or credentials.
    public sealed class TelemetryDocument
    {
        public int SchemaVersion { get; set; }
        public DateTimeOffset CollectedAtUtc { get; set; }
        public WorldGeneration World { get; set; }
        public Sample<ServerCounters> Server { get; set; }
        public Sample<LegacyCounters> LegacyBots { get; set; }
        public Sample<AiCounters> AiBots { get; set; }
    }
    public sealed class WorldGeneration
    {
        public int ProcessId { get; set; }
        public DateTimeOffset CreatedUtc { get; set; }
    }
    public sealed class Sample<T> where T : class
    {
        public string Status { get; set; }
        public string ErrorCode { get; set; }
        public DateTimeOffset ObservedAtUtc { get; set; }
        public T Data { get; set; }
    }
    public sealed class ServerCounters
    {
        public string CoreRevision { get; set; }
        public string UptimeDisplay { get; set; }
        public ulong ActiveSessions { get; set; }
        public ulong QueuedSessions { get; set; }
        public ulong PeakActiveSessions { get; set; }
        public ulong PeakQueuedSessions { get; set; }
    }
    public sealed class LegacyCounters
    {
        public ulong ConfiguredMin { get; set; }
        public ulong ConfiguredMax { get; set; }
        public ulong Registered { get; set; }
        public ulong Loading { get; set; }
        public ulong Online { get; set; }
        public ulong Chatting { get; set; }
        public ulong NonNativeBotSessions { get; set; }
        public ulong TotalWorldSessions { get; set; }
    }
    public sealed class AiCounters
    {
        public string Prefix { get; set; }
        public string PrefixOrigin { get; set; }
        public int ConfiguredAccounts { get; set; }
        public int? ConfiguredMinBots { get; set; }
        public int? ConfiguredMaxBots { get; set; }
        public DateTimeOffset InventoryObservedAtUtc { get; set; }
        public ulong AccountsInventory { get; set; }
        public ulong CharactersInventory { get; set; }
        public ulong OnlineCharactersTotal { get; set; }
        public ulong OnlineRandomAiCandidates { get; set; }
        public ulong OnlineOtherCharacters { get; set; }
        public ulong OnlineOrphanCharacters { get; set; }
        public ulong OnlineRandomAiAccounts { get; set; }
    }
    public sealed class SampleView<T> where T : class
    {
        public string State { get; set; }
        public string Source { get; set; }
        public DateTimeOffset? ObservedAtUtc { get; set; }
        public long? AgeSeconds { get; set; }
        public string ErrorCode { get; set; }
        public T Data { get; set; }
    }
    public sealed class TelemetryView
    {
        public string State { get; set; }
        public int FreshForSeconds { get; set; }
        public DateTimeOffset? CollectedAtUtc { get; set; }
        public SampleView<ServerCounters> Server { get; set; }
        public SampleView<LegacyCounters> LegacyBots { get; set; }
        public SampleView<AiCounters> AiBots { get; set; }
    }
    public static class TelemetryRules
    {
        public const int FreshForSeconds = 30;
        private static void Require(bool valid) { if (!valid) throw new FormatException("TELEMETRY_INVALID"); }
        private static void Text(string value, int cap) { Require(!String.IsNullOrWhiteSpace(value) && value.Length <= cap && value.IndexOf('\0') < 0); }
        private static void Counts(params ulong[] values) { foreach (ulong value in values) Require(value <= 1000000000); }
        private static void Time(DateTimeOffset value, TelemetryDocument doc)
        {
            Require(value.Offset == TimeSpan.Zero && value >= doc.World.CreatedUtc && value <= doc.CollectedAtUtc &&
                (doc.CollectedAtUtc - value).TotalSeconds <= 120);
        }
        private static void Sample<T>(Sample<T> sample, TelemetryDocument doc) where T : class
        {
            Require(sample != null); Time(sample.ObservedAtUtc, doc);
            Require(sample.Status == "ok" || sample.Status == "error");
            if (sample.Status == "ok") Require(sample.Data != null && sample.ErrorCode == null);
            else Require(sample.Data == null && sample.ErrorCode != null &&
                Regex.IsMatch(sample.ErrorCode, "^[A-Z0-9_]{1,48}$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)));
        }
        public static void Validate(TelemetryDocument doc)
        {
            Require(doc != null && doc.SchemaVersion == 1 && doc.World != null && doc.World.ProcessId > 0);
            Require(doc.CollectedAtUtc.Offset == TimeSpan.Zero && doc.World.CreatedUtc.Offset == TimeSpan.Zero &&
                doc.World.CreatedUtc.Year >= 2020 && doc.CollectedAtUtc >= doc.World.CreatedUtc);
            Sample(doc.Server, doc); Sample(doc.LegacyBots, doc); Sample(doc.AiBots, doc);
            if (doc.Server.Data != null)
            {
                ServerCounters data = doc.Server.Data; Text(data.CoreRevision, 512); Text(data.UptimeDisplay, 256);
                Require(Regex.IsMatch(data.CoreRevision, @"\A[0-9a-f]{20}(?:[0-9a-f]{20})?(?:[ +(-][^\r\n\0]*)?\z", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100))); // Approved release identity belongs to the protected collector.
                Counts(data.ActiveSessions, data.QueuedSessions, data.PeakActiveSessions, data.PeakQueuedSessions);
                Require(data.PeakActiveSessions >= data.ActiveSessions && data.PeakQueuedSessions >= data.QueuedSessions);
            }
            if (doc.LegacyBots.Data != null)
            {
                LegacyCounters data = doc.LegacyBots.Data;
                Counts(data.ConfiguredMin, data.ConfiguredMax, data.Registered, data.Loading, data.Online,
                    data.Chatting, data.NonNativeBotSessions, data.TotalWorldSessions);
                Require(data.TotalWorldSessions == data.NonNativeBotSessions + data.Online);
            }
            if (doc.AiBots.Data != null)
            {
                AiCounters data = doc.AiBots.Data; Text(data.Prefix, 16);
                Require(Regex.IsMatch(data.Prefix, "^[A-Za-z0-9_]{1,16}$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)));
                Require(data.PrefixOrigin == "RuntimeConfigFile" || data.PrefixOrigin == "PinnedSourceDefault");
                Require(data.ConfiguredAccounts >= 0 && data.ConfiguredAccounts <= 100000);
                Require(!data.ConfiguredMinBots.HasValue || data.ConfiguredMinBots.Value >= 0 && data.ConfiguredMinBots.Value <= 1000000);
                Require(!data.ConfiguredMaxBots.HasValue || data.ConfiguredMaxBots.Value >= 0 && data.ConfiguredMaxBots.Value <= 1000000);
                if (data.ConfiguredMinBots.HasValue && data.ConfiguredMaxBots.HasValue) Require(data.ConfiguredMinBots <= data.ConfiguredMaxBots);
                Time(data.InventoryObservedAtUtc, doc);
                Counts(data.AccountsInventory, data.CharactersInventory, data.OnlineCharactersTotal,
                    data.OnlineRandomAiCandidates, data.OnlineOtherCharacters, data.OnlineOrphanCharacters, data.OnlineRandomAiAccounts);
                Require(data.OnlineCharactersTotal == data.OnlineRandomAiCandidates + data.OnlineOtherCharacters + data.OnlineOrphanCharacters);
                Require(data.OnlineRandomAiAccounts <= data.OnlineRandomAiCandidates);
            }
        }
        private static SampleView<T> View<T>(Sample<T> sample, string source, string forced, DateTimeOffset now) where T : class
        {
            long? age = sample == null ? (long?)null : Math.Max(0, (long)(now - sample.ObservedAtUtc).TotalSeconds);
            string state = forced ?? (sample.Status == "error" ? "error" :
                (now - sample.ObservedAtUtc).TotalSeconds < -5 ? "clock_error" :
                (now - sample.ObservedAtUtc).TotalSeconds > FreshForSeconds ? "stale" : "ok");
            return new SampleView<T> { State = state, Source = source, ObservedAtUtc = sample == null ? (DateTimeOffset?)null : sample.ObservedAtUtc,
                AgeSeconds = age, ErrorCode = sample == null ? null : sample.ErrorCode, Data = state == "ok" ? sample.Data : null };
        }
        public static TelemetryView Missing(string state)
        {
            return new TelemetryView { State = state, FreshForSeconds = FreshForSeconds,
                Server = View<ServerCounters>(null, "SOAP server info", state, DateTimeOffset.UtcNow),
                LegacyBots = View<LegacyCounters>(null, "SOAP bot info", state, DateTimeOffset.UtcNow),
                AiBots = View<AiCounters>(null, "SQL characters.online + account prefix", state, DateTimeOffset.UtcNow) };
        }
        public static TelemetryView Evaluate(TelemetryDocument doc, DateTimeOffset now, int processId, DateTimeOffset? createdUtc)
        {
            Validate(doc);
            string forced = processId <= 0 ? "unavailable" : !createdUtc.HasValue ? "warming" :
                processId != doc.World.ProcessId || createdUtc.Value != doc.World.CreatedUtc ? "generation_changed" :
                (doc.CollectedAtUtc - now).TotalSeconds > 5 ? "clock_error" : null;
            TelemetryView result = new TelemetryView { FreshForSeconds = FreshForSeconds, CollectedAtUtc = doc.CollectedAtUtc,
                Server = View(doc.Server, "SOAP server info", forced, now), LegacyBots = View(doc.LegacyBots, "SOAP bot info", forced, now),
                AiBots = View(doc.AiBots, "SQL characters.online + account prefix", forced, now) };
            result.State = forced ?? (result.Server.State == "ok" && result.LegacyBots.State == "ok" && result.AiBots.State == "ok" ? "ok" :
                result.Server.State == "ok" || result.LegacyBots.State == "ok" || result.AiBots.State == "ok" ? "partial" :
                result.Server.State == "stale" && result.LegacyBots.State == "stale" && result.AiBots.State == "stale" ? "stale" : "error");
            return result;
        }
    }
}
