using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Xml;

namespace Vmangos.Accounts.Core;

// Values must come from trusted local process/token probes, never from a received frame.
public sealed record PeerProof(bool Local, bool FirstInstance, string TokenSid, string ImageSha256,
    int ProcessId, DateTimeOffset CreatedUtc, Guid Generation);
public sealed record ExpectedPeer(string TokenSid, string ImageSha256, int ProcessId,
    DateTimeOffset CreatedUtc, Guid Generation);
public static class PeerRules
{
    public static bool Accept(PeerProof proof, ExpectedPeer expected) => proof.Local && proof.FirstInstance &&
        expected.ProcessId > 0 && expected.Generation != Guid.Empty && expected.CreatedUtc.Offset == TimeSpan.Zero &&
        AccountPolicy.ValidSid(expected.TokenSid) && expected.CreatedUtc.Year >= 2020 &&
        expected.ImageSha256.Length == 64 && expected.ImageSha256.All(char.IsAsciiHexDigit) &&
        proof.TokenSid == expected.TokenSid && proof.ImageSha256 == expected.ImageSha256 && proof.ProcessId == expected.ProcessId &&
        proof.CreatedUtc == expected.CreatedUtc && proof.Generation == expected.Generation;
}

public static class AccountFrames
{
    public const int FrameCap = 4096;
    public static async Task<byte[]> ReadAsync(Stream stream, CancellationToken token)
    {
        byte[] prefix = new byte[4];
        await stream.ReadExactlyAsync(prefix, token);
        int length = BinaryPrimitives.ReadInt32LittleEndian(prefix);
        if (length is <= 0 or > FrameCap) throw new InvalidDataException("FRAME_INVALID");
        byte[] body = new byte[length];
        try { await stream.ReadExactlyAsync(body, token); return body; }
        catch { Array.Clear(body); throw; }
        finally { Array.Clear(prefix); }
    }
    public static bool TryDecode(ReadOnlyMemory<byte> body, PeerProof peer, ExpectedPeer expected,
        out CreateAccountRequest? request, out string operatorSid)
    {
        request = null; operatorSid = "";
        if (!PeerRules.Accept(peer, expected) || body.Length is 0 or > FrameCap) return false;
        try
        {
            using var document = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 2 });
            var root = document.RootElement;
            if (!StrictJson.Shape(root,"version","generation","operationId","accountName","password","operatorSid") ||
                root.GetProperty("version").GetString() != "1" ||
                !Guid.TryParseExact(root.GetProperty("generation").GetString(),"D",out Guid generation) || generation != expected.Generation ||
                !AccountPolicy.ValidSid(root.GetProperty("operatorSid").GetString())) return false;
            byte[] dto = JsonSerializer.SerializeToUtf8Bytes(new
            {
                operationId = root.GetProperty("operationId").GetString(), accountName = root.GetProperty("accountName").GetString(),
                password = root.GetProperty("password").GetString()
            });
            try { if (!AccountPolicy.TryParse(dto, out request)) return false; }
            finally { Array.Clear(dto); }
            operatorSid = root.GetProperty("operatorSid").GetString()!;
            return true;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException) { return false; }
    }
}

// Fixed XML mapping only. There is deliberately no HTTP client, credential reader or live-response classifier in A130.
public static class AccountSoapShape
{
    private const string SoapNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
    public static byte[] Build(CreateAccountRequest request)
    {
        if (!AccountPolicy.Valid(request)) throw new InvalidDataException("REQUEST_INVALID");
        using var buffer = new MemoryStream();
        using (var writer = XmlWriter.Create(buffer, new XmlWriterSettings { Encoding = new UTF8Encoding(false), CloseOutput = false }))
        {
            writer.WriteStartElement("soap","Envelope",SoapNamespace);
            writer.WriteStartElement("soap","Body",SoapNamespace);
            writer.WriteStartElement("executeCommand","urn:MaNGOS");
            writer.WriteStartElement("command"); writer.WriteString("account create "+request.AccountName+" ");
            request.Password.Use(chars =>
            {
                char[] copy = chars.ToArray();
                try { writer.WriteChars(copy,0,copy.Length); }
                finally { Array.Clear(copy); }
            });
            writer.WriteEndElement(); writer.WriteEndElement(); writer.WriteEndElement(); writer.WriteEndElement();
        }
        return buffer.ToArray();
    }
    public static bool IsBoundedResponse(ReadOnlyMemory<byte> raw)
    {
        if (raw.Length is 0 or > 65536) return false;
        try
        {
            using var memory = new MemoryStream(raw.ToArray(),writable:false);
            using var reader = XmlReader.Create(memory,new XmlReaderSettings
            { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 65536, MaxCharactersFromEntities = 0 });
            var doc = new XmlDocument { XmlResolver = null }; doc.Load(reader);
            var envelope = doc.DocumentElement;
            if (envelope is null || envelope.LocalName != "Envelope" || envelope.NamespaceURI != SoapNamespace) return false;
            var elements = envelope.ChildNodes.OfType<XmlElement>().ToArray();
            if (elements.Length != 1 || elements[0].LocalName != "Body" || elements[0].NamespaceURI != SoapNamespace) return false;
            var children = elements[0].ChildNodes.OfType<XmlElement>().ToArray();
            return children.Length == 1 && children[0].LocalName == "executeCommandResponse" && children[0].NamespaceURI == "urn:MaNGOS";
        }
        catch (Exception error) when (error is XmlException or InvalidOperationException or ArgumentException) { return false; }
    }
}
