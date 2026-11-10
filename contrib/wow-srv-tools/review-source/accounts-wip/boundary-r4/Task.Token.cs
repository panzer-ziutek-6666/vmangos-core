using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
namespace BoundaryR4 {
 public sealed class GroupInfo { public string Sid; public uint Attributes; }
 public sealed class PrivilegeInfo { public string Name; public uint Attributes; }
 public sealed class TokenInfo { public string UserSid, OwnerSid, PrimaryGroupSid; public int SessionId, TokenType, ElevationType, Elevated; public GroupInfo[] Groups; public PrivilegeInfo[] Privileges; }
 public static class QueryToken {
  [StructLayout(LayoutKind.Sequential)] struct SA { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct TG { public uint Count; public SA First; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int cls,IntPtr data,int size,out int required);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool LookupPrivilegeName(string system,IntPtr luid,StringBuilder name,ref int length);
  static IntPtr Info(IntPtr token,int cls) { int n;GetTokenInformation(token,cls,IntPtr.Zero,0,out n);if(n<=0)throw new Win32Exception(Marshal.GetLastWin32Error());IntPtr p=Marshal.AllocHGlobal(n);if(!GetTokenInformation(token,cls,p,n,out n)){int err=Marshal.GetLastWin32Error();Marshal.FreeHGlobal(p);throw new Win32Exception(err);}return p; }
  static string Sid(IntPtr t,int cls) {IntPtr p=Info(t,cls);try{return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;}finally{Marshal.FreeHGlobal(p);}}
  static int Number(IntPtr t,int cls) {IntPtr p=Info(t,cls);try{return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
  public static TokenInfo Read() {
   IntPtr t;if(!OpenProcessToken(GetCurrentProcess(),8,out t))throw new Win32Exception(Marshal.GetLastWin32Error());
   try {
    TokenInfo r=new TokenInfo();r.UserSid=Sid(t,1);r.OwnerSid=Sid(t,4);r.PrimaryGroupSid=Sid(t,5);r.SessionId=Number(t,12);r.TokenType=Number(t,8);r.ElevationType=Number(t,18);r.Elevated=Number(t,20);
    IntPtr p=Info(t,2);try {int count=Marshal.ReadInt32(p);int offset=(int)Marshal.OffsetOf(typeof(TG),"First");int stride=Marshal.SizeOf(typeof(SA));var groups=new List<GroupInfo>();for(int i=0;i<count;i++){SA g=(SA)Marshal.PtrToStructure(IntPtr.Add(p,offset+i*stride),typeof(SA));groups.Add(new GroupInfo{Sid=new SecurityIdentifier(g.Sid).Value,Attributes=g.Attributes});}r.Groups=groups.ToArray();}finally{Marshal.FreeHGlobal(p);}
    p=Info(t,3);try {int count=Marshal.ReadInt32(p);var privs=new List<PrivilegeInfo>();for(int i=0;i<count;i++){IntPtr item=IntPtr.Add(p,4+i*12);int size=256;StringBuilder name=new StringBuilder(size);if(!LookupPrivilegeName(null,item,name,ref size))throw new Win32Exception(Marshal.GetLastWin32Error());privs.Add(new PrivilegeInfo{Name=name.ToString(),Attributes=unchecked((uint)Marshal.ReadInt32(item,8))});}r.Privileges=privs.ToArray();}finally{Marshal.FreeHGlobal(p);}
    return r;
   } finally {CloseHandle(t);}
  }
 }
}
