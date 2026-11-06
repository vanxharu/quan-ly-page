$ErrorActionPreference='Stop'
$source=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Updater.cs') -Raw -Encoding UTF8)+"`n"+(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'PublicProfile.cs') -Raw -Encoding UTF8)
$tests=@'
namespace UpdaterTests {
  public class FailingEngine : MetaAssistantUpdater.Engine {
    int count;
    public FailingEngine(string root):base(root){}
    protected override void InstallFile(string source,string target){base.InstallFile(source,target);if(++count==2)throw new System.IO.IOException("injected copy failure");}
  }
  public static class Suite {
    static int passed;
    static void Check(bool value,string name){if(!value)throw new System.Exception(name);passed++;}
    static string Manifest(string version,bool native,string name){return "{\"manifest_version\":3,\"name\":\""+name+"\",\"version\":\""+version+"\",\"permissions\":[\"storage\""+(native?",\"nativeMessaging\"":"")+"],\"host_permissions\":[\"https://chatgpt.com/*\"]}";}
    static byte[] Zip(string manifest,string extra){using(var stream=new System.IO.MemoryStream()){using(var zip=new System.IO.Compression.ZipArchive(stream,System.IO.Compression.ZipArchiveMode.Create,true)){foreach(var pair in new[]{new[]{"manifest.json",manifest},new[]{"background.js","new-js"},new[]{extra??"icons/logo.png","new-image"}}){using(var writer=new System.IO.StreamWriter(zip.CreateEntry(pair[0]).Open()))writer.Write(pair[1]);}}return stream.ToArray();}}
    static void Reject(System.Action action,string name){bool failed=false;try{action();}catch{failed=true;}Check(failed,name);}
    public static string Run(string root){System.IO.Directory.CreateDirectory(root);var target=System.IO.Path.Combine(root,"extension");System.IO.Directory.CreateDirectory(target);var manifest=System.IO.Path.Combine(target,"manifest.json");var js=System.IO.Path.Combine(target,"background.js");var old=Manifest("2.2.1",false,"Meta Assistant Test");System.IO.File.WriteAllText(manifest,old);System.IO.File.WriteAllText(js,"old-js");var engine=new MetaAssistantUpdater.Engine(System.IO.Path.Combine(root,"work"));var good=Zip(Manifest("2.4.0",true,"Meta Assistant Test"),null);
      Reject(()=>engine.Apply(good,target,false),"permission expansion blocked");Check(System.IO.File.ReadAllText(js)=="old-js","unchanged after permission failure");
      var result=engine.Apply(good,target,true);Check((bool)result["updated"],"bootstrap succeeds");Check(System.IO.File.ReadAllText(js)=="new-js","overwrites original folder");Check(System.IO.File.ReadAllText(System.IO.Path.Combine((string)result["backup"],"background.js"))=="old-js","backup retained");Check(!(bool)engine.Apply(good,target,false)["updated"],"equal version no reload");
      Reject(()=>engine.Apply(Zip(Manifest("2.3.0",true,"Meta Assistant Test"),null),target,false),"downgrade blocked");Reject(()=>engine.Apply(Zip(Manifest("2.5.0",true,"Meta Assistant Other"),null),target,false),"identity mismatch blocked");Reject(()=>engine.Apply(Zip(Manifest("2.5.0",true,"Meta Assistant Test"),"../escape.js"),target,false),"ZIP traversal blocked");Check(!System.IO.File.Exists(System.IO.Path.Combine(root,"escape.js")),"no escaped file");
      var before=System.IO.File.ReadAllText(manifest);Reject(()=>new FailingEngine(System.IO.Path.Combine(root,"rollback")).Apply(Zip(Manifest("2.5.0",true,"Meta Assistant Test"),"new-file.js"),target,false),"injected copy failure");Check(System.IO.File.ReadAllText(js)=="new-js"&&System.IO.File.ReadAllText(manifest)==before&&!System.IO.File.Exists(System.IO.Path.Combine(target,"new-file.js")),"rollback restores existing and removes newly copied file");
      var expanded=Manifest("2.5.0",true,"Meta Assistant Test").Replace("\"storage\"","\"storage\",\"debugger\"");Reject(()=>engine.Apply(Zip(expanded,null),target,false),"new permissions blocked");
      var html="<meta property='al:android:url' content='fb://profile/100000000123456'><meta property='al:ios:url' content='fb://profile/100000000123456'><meta property='og:title' content='Test &amp; Customer'><meta property='og:url' content='https://www.facebook.com/test.customer/'><meta property='og:image' content='https://scontent.test.fbcdn.net/avatar.jpg?x=1&amp;y=2'>";
      var identity=MetaAssistantUpdater.PublicProfile.Parse(html,"https://www.facebook.com/test.customer");Check((string)identity["uid"]=="100000000123456"&&(string)identity["name"]=="Test & Customer","public UID comes from profile metadata");
      Reject(()=>MetaAssistantUpdater.PublicProfile.Normalize("https://evil.example/customer"),"external URL rejected");Reject(()=>MetaAssistantUpdater.PublicProfile.Normalize("https://www.facebook.com/login"),"login route rejected");
      Reject(()=>MetaAssistantUpdater.PublicProfile.Parse("<html>Login</html>","https://www.facebook.com/test.customer"),"missing UID rejected");Reject(()=>MetaAssistantUpdater.PublicProfile.Parse(html,"100000000999999"),"PSID to different UID rejected");Reject(()=>MetaAssistantUpdater.PublicProfile.Parse(html.Replace("scontent.test.fbcdn.net","evil.example"),"https://www.facebook.com/test.customer"),"external image rejected");
      return "PASS: "+passed+" updater checks: original folder, backup, permission bootstrap, equal version, downgrade, identity, traversal, partial-write rollback.";
    }
  }
}
'@
Add-Type -TypeDefinition ($source+"`n"+$tests) -ReferencedAssemblies @('System.Web.Extensions','System.Web','System.IO.Compression','System.IO.Compression.FileSystem','System.Windows.Forms','System.Drawing','System.Core')
$testRoot=Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')) ('ut-'+[guid]::NewGuid().ToString('N').Substring(0,8))
[UpdaterTests.Suite]::Run($testRoot)
