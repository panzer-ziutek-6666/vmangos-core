using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;
namespace WowReleaseV1 {
 public static class Secure {
  public const string Pool="S-1-5-82-2192834305-681035450-1731772730-1791053079-2169464979";
  [StructLayout(LayoutKind.Sequential)] struct SA {public int Length;public IntPtr Descriptor;public int Inherit;}
  [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool MkDir(string p,ref SA s);
  [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle MkFile(string p,uint a,uint share,ref SA s,uint disp,uint flags,IntPtr template);
  public static void Canonical(string p) {if(String.IsNullOrEmpty(p)||p.Length>230||!Path.IsPathRooted(p)||p.StartsWith(@"\\")||Path.GetFullPath(p)!=p||p.IndexOf(':',2)>=0)throw new InvalidOperationException("LOCAL_PATH_REQUIRED");string q=p;while(!String.IsNullOrEmpty(q)){if((File.Exists(q)||Directory.Exists(q))&&(File.GetAttributes(q)&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("REPARSE_REFUSED");q=Path.GetDirectoryName(q);}}
  public static void Verify(string p,bool directory,bool telemetry) {
   Canonical(p);FileSystemSecurity acl=directory?(FileSystemSecurity)Directory.GetAccessControl(p):File.GetAccessControl(p);
   if(!acl.AreAccessRulesProtected)throw new InvalidOperationException("PRIVATE_DACL_REQUIRED");string owner=acl.GetOwner(typeof(SecurityIdentifier)).Value;if(owner!="S-1-5-18"&&owner!="S-1-5-32-544")throw new InvalidOperationException("UNTRUSTED_OWNER");
   var rules=acl.GetAccessRules(true,true,typeof(SecurityIdentifier));if(rules.Count!=(telemetry?3:2))throw new InvalidOperationException("DACL_RULE_COUNT");bool sy=false,ba=false,pool=false;
   foreach(FileSystemAccessRule r in rules){if(r.AccessControlType!=AccessControlType.Allow||r.IsInherited||r.PropagationFlags!=PropagationFlags.None||r.InheritanceFlags!=(directory?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None))throw new InvalidOperationException("EXPLICIT_DACL_REQUIRED");string sid=r.IdentityReference.Value;if(sid=="S-1-5-18"&&!sy&&r.FileSystemRights==FileSystemRights.FullControl)sy=true;else if(sid=="S-1-5-32-544"&&!ba&&r.FileSystemRights==FileSystemRights.FullControl)ba=true;else if(telemetry&&sid==Pool&&!pool&&(long)r.FileSystemRights==0x1200a9)pool=true;else throw new InvalidOperationException("UNTRUSTED_ACE");}
   if(!sy||!ba||pool!=telemetry)throw new InvalidOperationException("DACL_INCOMPLETE");
  }
  static byte[] Descriptor(bool directory,bool telemetry){string f=directory?"OICI":"";string s="O:BAG:BAD:P(A;"+f+";FA;;;SY)(A;"+f+";FA;;;BA)"+(telemetry?"(A;"+f+";0x1200a9;;;"+Pool+")":"");var d=new RawSecurityDescriptor(s);byte[] b=new byte[d.BinaryLength];d.GetBinaryForm(b,0);return b;}
  public static void NewDirectory(string p,bool telemetry){Canonical(p);if(!Directory.Exists(Path.GetDirectoryName(p)))throw new InvalidOperationException("PARENT_MISSING");byte[] b=Descriptor(true,telemetry);var pin=GCHandle.Alloc(b,GCHandleType.Pinned);SA a=new SA{Length=Marshal.SizeOf(typeof(SA)),Descriptor=pin.AddrOfPinnedObject()};try{if(!MkDir(p,ref a))throw new Win32Exception(Marshal.GetLastWin32Error(),"EXCLUSIVE_DIRECTORY_CREATE");}finally{pin.Free();}Verify(p,true,telemetry);}
  public static void NewFile(string p,byte[] b,bool telemetry){Canonical(p);Verify(Path.GetDirectoryName(p),true,telemetry);if(b.Length>1048576)throw new InvalidOperationException("FILE_CAP");byte[] d=Descriptor(false,telemetry);var pin=GCHandle.Alloc(d,GCHandleType.Pinned);SA a=new SA{Length=Marshal.SizeOf(typeof(SA)),Descriptor=pin.AddrOfPinnedObject()};try{using(var h=MkFile(p,0x40000000,0,ref a,1,0x80,IntPtr.Zero)){if(h.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error(),"EXCLUSIVE_FILE_CREATE");using(var f=new FileStream(h,FileAccess.Write)){f.Write(b,0,b.Length);f.Flush(true);}}}finally{pin.Free();}Verify(p,false,telemetry);}
  public static void Atomic(string p,string json,bool telemetry){Verify(Path.GetDirectoryName(p),true,telemetry);if(File.Exists(p))Verify(p,false,telemetry);byte[] b=new UTF8Encoding(false,true).GetBytes(json);if(b.Length>(telemetry?32768:131072))throw new InvalidOperationException("JSON_CAP");string t=Path.Combine(Path.GetDirectoryName(p),"write-"+Guid.NewGuid().ToString("N")+".tmp");NewFile(t,b,telemetry);try{if(File.Exists(p))File.Replace(t,p,null);else File.Move(t,p);Verify(p,false,telemetry);}finally{if(File.Exists(t)){Verify(t,false,telemetry);File.Delete(t);}}}
  public static string Hash(string p){Canonical(p);using(var s=new FileStream(p,FileMode.Open,FileAccess.Read,FileShare.Read))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(s)).Replace("-","");}
  public static string Read(string p,bool telemetry){Verify(p,false,telemetry);var b=File.ReadAllBytes(p);if(b.Length==0||b.Length>(telemetry?32768:131072))throw new InvalidOperationException("JSON_CAP");string j=new UTF8Encoding(false,true).GetString(b).TrimStart('\uFEFF');JsonKeys.Check(j);return j;}
  public static FileStream Lock(string p,int milliseconds){Verify(p,false,false);var w=System.Diagnostics.Stopwatch.StartNew();while(true){try{return new FileStream(p,FileMode.Open,FileAccess.ReadWrite,FileShare.None);}catch(IOException){if(w.ElapsedMilliseconds>=milliseconds)throw new InvalidOperationException("REGISTRY_BUSY");System.Threading.Thread.Sleep(25);}}}
  public static void Delete(string p,bool telemetry){Verify(p,false,telemetry);File.Delete(p);}
 }
 public sealed class JsonKeys {
  string s;int i,depth;
  public static void Check(string s){var p=new JsonKeys{s=s};p.Value();p.Ws();if(p.i!=s.Length)throw new FormatException("JSON_TRAILING");}
  void Ws(){while(i<s.Length&&Char.IsWhiteSpace(s[i]))i++;}
  void Eat(char c){Ws();if(i>=s.Length||s[i++]!=c)throw new FormatException("JSON_SYNTAX");}
  string Str(){Ws();Eat('"');var b=new StringBuilder();while(i<s.Length){char c=s[i++];if(c=='"')return b.ToString();if(c<' ')throw new FormatException("JSON_STRING");if(c=='\\'){if(i==s.Length)break;c=s[i++];if(c=='u'){if(i+4>s.Length)break;b.Append((char)Convert.ToInt32(s.Substring(i,4),16));i+=4;}else{int k="\"\\/bfnrt".IndexOf(c);if(k<0)throw new FormatException("JSON_ESCAPE");b.Append("\"\\/\b\f\n\r\t"[k]);}}else b.Append(c);}throw new FormatException("JSON_STRING");}
  void Value(){Ws();if(++depth>16||i>=s.Length)throw new FormatException("JSON_DEPTH");char c=s[i];if(c=='{'){i++;Ws();var keys=new HashSet<string>(StringComparer.OrdinalIgnoreCase);if(i<s.Length&&s[i]=='}'){i++;depth--;return;}while(true){string k=Str();if(!keys.Add(k))throw new FormatException("JSON_DUPLICATE_KEY");Eat(':');Value();Ws();if(i<s.Length&&s[i]=='}'){i++;break;}Eat(',');}}
   else if(c=='['){i++;Ws();if(i<s.Length&&s[i]==']'){i++;depth--;return;}while(true){Value();Ws();if(i<s.Length&&s[i]==']'){i++;break;}Eat(',');}}
   else if(c=='"')Str();else if(s.Substring(i).StartsWith("true"))i+=4;else if(s.Substring(i).StartsWith("false"))i+=5;else if(s.Substring(i).StartsWith("null"))i+=4;else{var m=System.Text.RegularExpressions.Regex.Match(s.Substring(i),@"\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?");if(!m.Success)throw new FormatException("JSON_VALUE");i+=m.Length;}depth--;}
 }
}
