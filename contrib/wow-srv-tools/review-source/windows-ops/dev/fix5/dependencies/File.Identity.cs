using System;
using System.IO;
using System.Runtime.InteropServices;
namespace AdminInstallV1 {
 public static class Files {
  [StructLayout(LayoutKind.Sequential)] struct Info {public uint Attr;public System.Runtime.InteropServices.ComTypes.FILETIME Created,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle,out Info info);
  public static string Identity(string path){using(var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){Info i;if(!GetFileInformationByHandle(f.SafeFileHandle,out i))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return i.Volume.ToString("X8")+":"+i.IndexHigh.ToString("X8")+i.IndexLow.ToString("X8");}}
  public static void Replace(string from,string to){File.Replace(from,to,null);}
 }
}
