using System;
using System.IO;
using System.IO.Compression;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Win32;

namespace MetaAssistantUpdater {
  public class Engine {
    public const string HostName="com.metaassistant.updater";
    public const string PackageUrl="https://vanxharu.github.io/quan-ly-page/chatgpt-connector.zip";
    public static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=1048576 };
    readonly string work;
    public Engine(string workDirectory){work=Path.GetFullPath(workDirectory);}
    public static Dictionary<string,object> ReadJson(string file){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));}
    public static string Get(Dictionary<string,object> d,string key){object v;return d.TryGetValue(key,out v)&&v!=null?Convert.ToString(v):"";}
    public static Version VersionOf(string value){if(!Regex.IsMatch(value,@"^\d+(\.\d+){1,3}$"))throw new Exception("Phiên bản không hợp lệ.");var p=value.Split('.').Select(Int32.Parse).ToArray();if(p.Any(x=>x<0||x>65535))throw new Exception("Phiên bản không hợp lệ.");return new Version(p[0],p[1],p.Length>2?p[2]:0,p.Length>3?p[3]:0);}
    public static bool Under(string root,string file){return Path.GetFullPath(file).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
    public static void NoLinks(string path){var p=Path.GetFullPath(path);while(!String.IsNullOrEmpty(p)){if((File.Exists(p)||Directory.Exists(p))&&(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new Exception("Không cập nhật qua liên kết thư mục.");p=Path.GetDirectoryName(p);}}
    public static Dictionary<string,object> Installed(string target){target=Path.GetFullPath(target);NoLinks(target);var m=ReadJson(Path.Combine(target,"manifest.json"));if(!Get(m,"name").StartsWith("Meta Assistant",StringComparison.Ordinal)||Get(m,"manifest_version")!="3")throw new Exception("Thư mục không phải tiện ích Meta Assistant.");VersionOf(Get(m,"version"));return m;}
    static HashSet<string> Items(Dictionary<string,object> m,string key){var result=new HashSet<string>(StringComparer.Ordinal);object raw;if(m.TryGetValue(key,out raw)&&raw is IEnumerable)foreach(var item in (IEnumerable)raw)result.Add(Convert.ToString(item));return result;}
    public static byte[] Download(){ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;var req=(HttpWebRequest)WebRequest.Create(PackageUrl+"?update="+DateTime.UtcNow.Ticks);req.AllowAutoRedirect=false;req.Timeout=45000;req.ReadWriteTimeout=45000;req.UserAgent="MetaAssistantUpdater/1.0";using(var response=(HttpWebResponse)req.GetResponse()){if(response.StatusCode!=HttpStatusCode.OK)throw new Exception("Máy chủ chưa trả về gói cập nhật.");using(var stream=response.GetResponseStream())using(var memory=new MemoryStream()){var buffer=new byte[32768];int n;while((n=stream.Read(buffer,0,buffer.Length))>0){if(memory.Length+n>16777216)throw new Exception("Gói cập nhật quá lớn.");memory.Write(buffer,0,n);}return memory.ToArray();}}}
    protected virtual void InstallFile(string source,string target){File.Copy(source,target,true);}
    public Dictionary<string,object> Apply(byte[] zip,string target,bool bootstrap){
      target=Path.GetFullPath(target);var previous=Installed(target);Directory.CreateDirectory(work);NoLinks(work);
      string lockName;using(var hash=System.Security.Cryptography.SHA256.Create()){lockName=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(target.ToLowerInvariant()))).Replace("-","");}
      using(var mutex=new Mutex(false,"Local\\MetaAssistantUpdater_"+lockName)){
        bool held=false;try{try{held=mutex.WaitOne(0);}catch(AbandonedMutexException){held=true;}if(!held)throw new Exception("Một lần cập nhật khác đang chạy.");
          var stageRoot=Path.Combine(work,"staging");Directory.CreateDirectory(stageRoot);NoLinks(stageRoot);var stage=Path.Combine(stageRoot,Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
          try{
            var files=new List<string>();long total=0;
            using(var memory=new MemoryStream(zip))using(var archive=new ZipArchive(memory,ZipArchiveMode.Read)){
              if(archive.Entries.Count>200)throw new Exception("Gói cập nhật có quá nhiều tệp.");
              foreach(var entry in archive.Entries){var name=entry.FullName.Replace('\\','/');if(name.EndsWith("/"))continue;
                if(String.IsNullOrEmpty(name)||Path.IsPathRooted(name)||name.Contains(":")||name.Split('/').Any(x=>x=="."||x==".."||x.EndsWith(".")||x.EndsWith(" "))||((entry.ExternalAttributes>>16)&0xf000)==0xa000)throw new Exception("Đường dẫn ZIP không hợp lệ.");
                var ext=Path.GetExtension(name).ToLowerInvariant();if(!new[]{".js",".json",".html",".css",".png",".txt"}.Contains(ext))throw new Exception("Gói chứa loại tệp không được hỗ trợ.");
                var dest=Path.GetFullPath(Path.Combine(stage,name));if(!Under(stage,dest)||files.Contains(name,StringComparer.OrdinalIgnoreCase))throw new Exception("Đường dẫn ZIP bị trùng hoặc vượt thư mục.");
                total+=entry.Length;if(entry.Length>20971520||total>33554432)throw new Exception("Dữ liệu giải nén quá lớn.");Directory.CreateDirectory(Path.GetDirectoryName(dest));using(var input=entry.Open())using(var output=File.Create(dest)){var buffer=new byte[32768];int n;long size=0;while((n=input.Read(buffer,0,buffer.Length))>0){size+=n;if(size>entry.Length||size>20971520)throw new Exception("Kích thước ZIP không hợp lệ.");output.Write(buffer,0,n);}if(size!=entry.Length)throw new Exception("Tệp ZIP chưa đầy đủ.");}files.Add(name);
              }
            }
            var next=Installed(stage);if(Get(next,"name")!=Get(previous,"name")||Get(next,"key")!=Get(previous,"key"))throw new Exception("Gói không khớp tiện ích đang cài.");
            foreach(var key in new[]{"permissions","host_permissions","optional_permissions","optional_host_permissions"}){var old=Items(previous,key);foreach(var value in Items(next,key))if(!old.Contains(value)&&!(bootstrap&&key=="permissions"&&value=="nativeMessaging"))throw new Exception("Bản mới cần thêm quyền. Hãy cập nhật thủ công để xem quyền thay đổi.");}
            if(bootstrap&&!Items(next,"permissions").Contains("nativeMessaging"))throw new Exception("Gói trên web chưa có chức năng cập nhật. Hãy thử lại sau khi web cập nhật xong.");
            var currentVersion=VersionOf(Get(previous,"version"));var nextVersion=VersionOf(Get(next,"version"));if(nextVersion<currentVersion)throw new Exception("Không tự hạ phiên bản tiện ích.");
            if(nextVersion==currentVersion&&!bootstrap)return new Dictionary<string,object>{{"ok",true},{"updated",false},{"version",Get(previous,"version")}};
            var backup=Path.Combine(work,"backups",DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(backup);NoLinks(backup);var copied=new List<string>();var created=new List<string>();
            var ordered=files.OrderBy(name=>String.Equals(name,"manifest.json",StringComparison.OrdinalIgnoreCase)?1:0).ToArray();
            foreach(var name in ordered){var dest=Path.GetFullPath(Path.Combine(target,name));if(!Under(target,dest))throw new Exception("Tệp vượt thư mục tiện ích.");NoLinks(dest);if(Directory.Exists(dest))throw new Exception("Tên tệp trùng với thư mục hiện có.");if(File.Exists(dest)){var old=Path.Combine(backup,name);Directory.CreateDirectory(Path.GetDirectoryName(old));File.Copy(dest,old,true);}else created.Add(name);}
            try{foreach(var name in ordered){var dest=Path.GetFullPath(Path.Combine(target,name));NoLinks(dest);Directory.CreateDirectory(Path.GetDirectoryName(dest));copied.Add(name);InstallFile(Path.Combine(stage,name),dest);}}
            catch(Exception writeError){bool restored=true;foreach(var name in copied){try{var dest=Path.GetFullPath(Path.Combine(target,name));if(!Under(target,dest))throw new Exception();NoLinks(dest);var old=Path.Combine(backup,name);if(File.Exists(old))File.Copy(old,dest,true);else if(created.Contains(name)&&File.Exists(dest))File.Delete(dest);}catch{restored=false;}}throw new Exception(restored?"Cập nhật lỗi; đã phục hồi các tệp cũ. "+writeError.Message:"Cập nhật lỗi. Bản sao lưu còn tại "+backup);}
            return new Dictionary<string,object>{{"ok",true},{"updated",true},{"version",Get(next,"version")},{"previousVersion",Get(previous,"version")},{"backup",backup}};
          }finally{if(Under(stageRoot,stage)&&Directory.Exists(stage)){NoLinks(stage);Directory.Delete(stage,true);}}
        }finally{if(held)mutex.ReleaseMutex();}
      }
    }
  }
  public class Candidate {
    public string Browser,Id,Folder,Version;
    public override string ToString(){return Browser+" · "+Version+" · "+Folder;}
  }
  public static class Program {
    static string InstallRoot {get{return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"MetaAssistantUpdater");}}
    static string ConfigFile {get{return Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"updater-config.json");}}
    static string RegistryPath(string browser){if(browser=="CocCoc")return @"Software\CocCoc\Browser\NativeMessagingHosts\"+Engine.HostName;if(browser=="Chrome")return @"Software\Google\Chrome\NativeMessagingHosts\"+Engine.HostName;if(browser=="Edge")return @"Software\Microsoft\Edge\NativeMessagingHosts\"+Engine.HostName;throw new Exception("Trình duyệt chưa hỗ trợ.");}
    public static List<Candidate> FindInstalled(){
      var result=new List<Candidate>();var local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
      var browsers=new Dictionary<string,string>{{"CocCoc",@"CocCoc\Browser\User Data"},{"Chrome",@"Google\Chrome\User Data"},{"Edge",@"Microsoft\Edge\User Data"}};
      foreach(var browser in browsers){var root=Path.Combine(local,browser.Value);if(!Directory.Exists(root))continue;foreach(var profile in Directory.GetDirectories(root)){var pref=Path.Combine(profile,"Secure Preferences");if(!File.Exists(pref))continue;try{
        var json=Engine.ReadJson(pref);var extensions=json["extensions"] as Dictionary<string,object>;var settings=extensions["settings"] as Dictionary<string,object>;
        foreach(var item in settings){try{var entry=item.Value as Dictionary<string,object>;var folder=Engine.Get(entry,"path");if(!Path.IsPathRooted(folder)||!Regex.IsMatch(item.Key,"^[a-p]{32}$"))continue;var m=Engine.Installed(folder);if(result.Any(c=>c.Browser==browser.Key&&c.Id==item.Key&&c.Folder==folder))continue;result.Add(new Candidate{Browser=browser.Key,Id=item.Key,Folder=folder,Version=Engine.Get(m,"version")});}catch{}}
      }catch{}}}return result;
    }
    public static Dictionary<string,object> Install(Candidate candidate){
      if(!FindInstalled().Any(c=>c.Browser==candidate.Browser&&c.Id==candidate.Id&&String.Equals(c.Folder,candidate.Folder,StringComparison.OrdinalIgnoreCase)))throw new Exception("Không tìm thấy đúng thư mục tiện ích trong trình duyệt.");
      Directory.CreateDirectory(InstallRoot);Engine.NoLinks(InstallRoot);var engine=new Engine(InstallRoot);var result=engine.Apply(Engine.Download(),candidate.Folder,true);
      var exe=Path.Combine(InstallRoot,"MetaAssistantUpdater.exe");var source=System.Reflection.Assembly.GetExecutingAssembly().Location;if(!String.Equals(exe,source,StringComparison.OrdinalIgnoreCase))File.Copy(source,exe,true);
      var origin="chrome-extension://"+candidate.Id+"/";var config=new Dictionary<string,object>{{"extensionPath",Path.GetFullPath(candidate.Folder)},{"origin",origin},{"browser",candidate.Browser}};
      File.WriteAllText(Path.Combine(InstallRoot,"updater-config.json"),Engine.Json.Serialize(config),new UTF8Encoding(false));
      var host=Path.Combine(InstallRoot,Engine.HostName+".json");File.WriteAllText(host,Engine.Json.Serialize(new Dictionary<string,object>{{"name",Engine.HostName},{"description","Meta Assistant extension updater"},{"path",exe},{"type","stdio"},{"allowed_origins",new[]{origin}}}),new UTF8Encoding(false));
      using(var key=Registry.CurrentUser.CreateSubKey(RegistryPath(candidate.Browser))){key.SetValue("",host,RegistryValueKind.String);}CustomerAvatarCache.Publish(InstallRoot);result["installed"]=true;result["folder"]=candidate.Folder;return result;
    }
    public static Dictionary<string,object> UpdateResult(Dictionary<string,object> result,string runningVersion,string uiVersion){
      object raw;bool filesUpdated=result.TryGetValue("updated",out raw)&&raw is bool&&(bool)raw;
      bool reloadRequired=filesUpdated||String.IsNullOrEmpty(runningVersion)||String.IsNullOrEmpty(uiVersion)||runningVersion!=Engine.Get(result,"version")||uiVersion!=Engine.Get(result,"version");
      result["filesUpdated"]=filesUpdated;result["reloadRequired"]=reloadRequired;
      // Older workers only inspect updated. They must still reload when files were already replaced.
      if(String.IsNullOrEmpty(runningVersion))result["updated"]=reloadRequired;
      return result;
    }
    static byte[] ReadExact(Stream stream,int length){var buffer=new byte[length];int offset=0,n;while(offset<length&&(n=stream.Read(buffer,offset,length-offset))>0)offset+=n;if(offset!=length)throw new Exception("Thông điệp chưa đầy đủ.");return buffer;}
    static void Reply(Dictionary<string,object> data){var bytes=Encoding.UTF8.GetBytes(Engine.Json.Serialize(data));var output=Console.OpenStandardOutput();var length=BitConverter.GetBytes(bytes.Length);output.Write(length,0,4);output.Write(bytes,0,bytes.Length);output.Flush();}
    static void Native(string origin){try{var config=Engine.ReadJson(ConfigFile);if(origin!=Engine.Get(config,"origin"))throw new Exception("Tiện ích không được phép cập nhật.");var input=Console.OpenStandardInput();var length=BitConverter.ToInt32(ReadExact(input,4),0);if(length<2||length>65536)throw new Exception("Thông điệp không hợp lệ.");var message=Engine.Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadExact(input,length)));var target=Engine.Get(config,"extensionPath");
      if(Engine.Get(message,"action")=="status"){var m=Engine.Installed(target);Reply(new Dictionary<string,object>{{"ok",true},{"version",Engine.Get(m,"version")},{"hostVersion","2.5.0"},{"features",new[]{"public_profile","avatar_diagnostic","update"}}});}
      else if(Engine.Get(message,"action")=="avatar_diagnostic")Reply(AvatarDiagnostics.Record(AppDomain.CurrentDomain.BaseDirectory,message));
      else if(Engine.Get(message,"action")=="public_profile")Reply(CustomerAvatarCache.Attach(AppDomain.CurrentDomain.BaseDirectory,Engine.Get(message,"profile"),PublicProfile.ReadForHost(Engine.Get(message,"profile"),AppDomain.CurrentDomain.BaseDirectory)));
      else if(Engine.Get(message,"action")=="update")Reply(UpdateResult(new Engine(AppDomain.CurrentDomain.BaseDirectory).Apply(Engine.Download(),target,false),Engine.Get(message,"runningVersion"),Engine.Get(message,"uiVersion")));else throw new Exception("Lệnh cập nhật không hợp lệ.");
    }catch(Exception e){Reply(new Dictionary<string,object>{{"ok",false},{"error",e.Message}});}}
    [STAThread] public static void Main(string[] args){
      if(args.Length>0&&args[0].StartsWith("chrome-extension://",StringComparison.Ordinal)){Native(args[0]);return;}
      if(args.Length==4&&args[0]=="--install"){try{var found=FindInstalled().FirstOrDefault(c=>c.Browser==args[1]&&c.Id==args[2]&&String.Equals(c.Folder,args[3],StringComparison.OrdinalIgnoreCase));if(found==null)throw new Exception("Không tìm thấy tiện ích được chọn.");Console.WriteLine(Engine.Json.Serialize(Install(found)));}catch(Exception e){Console.WriteLine(Engine.Json.Serialize(new Dictionary<string,object>{{"ok",false},{"error",e.Message}}));Environment.ExitCode=1;}return;}
      Application.EnableVisualStyles();var form=new Form{Text="Cập nhật Meta Assistant",Width=660,Height=275,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,Font=new Font("Segoe UI",10)};
      var text=new Label{Text="Chọn tiện ích đang dùng. Bộ cập nhật sẽ sao lưu và chép đè đúng thư mục này.",Left=20,Top=18,Width=610,Height=42};var combo=new ComboBox{Left=20,Top=66,Width=610,DropDownStyle=ComboBoxStyle.DropDownList};foreach(var c in FindInstalled())combo.Items.Add(c);if(combo.Items.Count>0)combo.SelectedIndex=0;
      var status=new Label{Left=20,Top=108,Width=610,Height=64,Text=combo.Items.Count>0?"Cài một lần. Sau đó dùng nút Cập nhật trong Studio AI.":"Chưa tìm thấy tiện ích Meta Assistant dạng giải nén."};var button=new Button{Left=440,Top=178,Width=190,Height=38,Text="Cài và cập nhật",Enabled=combo.Items.Count>0};
      button.Click+=async delegate(object sender,EventArgs ev){button.Enabled=false;combo.Enabled=false;status.Text="Đang tải, sao lưu và cập nhật…";try{var chosen=(Candidate)combo.SelectedItem;var result=await System.Threading.Tasks.Task.Run(()=>Install(chosen));status.Text="Đã cài bản "+result["version"]+". Mở chrome://extensions và bấm Tải lại một lần, rồi mở Studio AI.";button.Text="Đã cài xong";}catch(Exception e){status.Text=e.Message;button.Enabled=true;combo.Enabled=true;}};
      form.Controls.AddRange(new Control[]{text,combo,status,button});Application.Run(form);
    }
  }
}
