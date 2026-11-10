using System;
using System.IO;
using System.Runtime.InteropServices;
namespace AfterBootRepairR2 {
 public static class Native {
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  public static byte[] ReadPublication(string path,int cap) {
   // Publisher uses CreateNew(temp), Flush, Close, then File.Replace.
   // Permit replacement; do not permit an in-place writer to the opened image.
   using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete)) {
    if(stream.Length==0||stream.Length>cap)throw new InvalidOperationException("JSON_CAP");
    byte[] bytes=new byte[(int)stream.Length];int offset=0;
    while(offset<bytes.Length){int got=stream.Read(bytes,offset,bytes.Length-offset);if(got==0)throw new EndOfStreamException("JSON_TRUNCATED");offset+=got;}
    if(stream.ReadByte()!=-1)throw new InvalidOperationException("JSON_CAP_CHANGED");
    return bytes;
   }
  }
 }
}
