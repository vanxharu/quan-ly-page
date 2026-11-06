namespace MetaAssistantUpdater {
  public static class CustomerAvatarCache {
    const string FileName="customer-avatar-cache.json";
    static string ImageData(string value){
      var uri=new System.Uri(value);
      for(int redirect=0;redirect<3;redirect++){
        if(uri.Scheme!="https"||uri.Port!=443||uri.UserInfo!=""||!uri.Host.EndsWith(".fbcdn.net",System.StringComparison.OrdinalIgnoreCase))throw new System.Exception("Avatar không thuộc CDN Facebook.");
        var request=(System.Net.HttpWebRequest)System.Net.WebRequest.Create(uri);request.AllowAutoRedirect=false;request.Timeout=10000;request.ReadWriteTimeout=10000;
        using(var response=(System.Net.HttpWebResponse)request.GetResponse()){
          if(new[]{301,302,303,307,308}.Contains((int)response.StatusCode)){uri=new System.Uri(uri,response.Headers["Location"]??"");continue;}
          if(response.StatusCode!=System.Net.HttpStatusCode.OK||!response.ContentType.StartsWith("image/",System.StringComparison.OrdinalIgnoreCase))throw new System.Exception("Facebook chưa trả dữ liệu ảnh.");
          using(var input=response.GetResponseStream())using(var memory=new System.IO.MemoryStream()){
            var buffer=new byte[32768];int n;while((n=input.Read(buffer,0,buffer.Length))>0){if(memory.Length+n>2097152)throw new System.Exception("Ảnh đại diện quá lớn.");memory.Write(buffer,0,n);}memory.Position=0;
            using(var image=System.Drawing.Image.FromStream(memory,true,true)){
              if(image.Width<1||image.Height<1||image.Width>8192||image.Height>8192)throw new System.Exception("Kích thước ảnh không hợp lệ.");
              using(var thumbnail=new System.Drawing.Bitmap(128,128))using(var graphics=System.Drawing.Graphics.FromImage(thumbnail))using(var output=new System.IO.MemoryStream()){
                graphics.Clear(System.Drawing.Color.Transparent);graphics.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                double scale=System.Math.Min(128.0/image.Width,128.0/image.Height);int w=System.Math.Max(1,(int)(image.Width*scale)),h=System.Math.Max(1,(int)(image.Height*scale));graphics.DrawImage(image,(128-w)/2,(128-h)/2,w,h);thumbnail.Save(output,System.Drawing.Imaging.ImageFormat.Png);
                return "data:image/png;base64,"+System.Convert.ToBase64String(output.ToArray());
              }
            }
          }
        }
      }
      throw new System.Exception("Link ảnh chuyển hướng quá nhiều lần.");
    }
    static System.Collections.Generic.Dictionary<string,object> Read(string directory){try{return Engine.ReadJson(System.IO.Path.Combine(directory,FileName));}catch{return new System.Collections.Generic.Dictionary<string,object>();}}
    static void Write(string root,string file,string data){
      root=System.IO.Path.GetFullPath(root);file=System.IO.Path.GetFullPath(file);if(!Engine.Under(root,file))throw new System.Exception("Tệp cache vượt thư mục.");Engine.NoLinks(root);Engine.NoLinks(file);
      var temp=file+"."+System.Guid.NewGuid().ToString("N")+".tmp";if(!Engine.Under(root,temp))throw new System.Exception("Tệp tạm vượt thư mục.");System.IO.File.WriteAllText(temp,data,new System.Text.UTF8Encoding(false));if(System.IO.File.Exists(file))System.IO.File.Replace(temp,file,null);else System.IO.File.Move(temp,file);
    }
    public static void Publish(string directory){
      string config=System.IO.Path.Combine(directory,"updater-config.json"),cache=System.IO.Path.Combine(directory,FileName);if(!System.IO.File.Exists(config)||!System.IO.File.Exists(cache))return;
      var target=Engine.Get(Engine.ReadJson(config),"extensionPath");Engine.Installed(target);Write(target,System.IO.Path.Combine(target,FileName),System.IO.File.ReadAllText(cache,System.Text.Encoding.UTF8));
    }
    public static System.Collections.Generic.Dictionary<string,object> Attach(string directory,string requested,System.Collections.Generic.Dictionary<string,object> profile){
      string uid=Engine.Get(profile,"uid"),source=Engine.Get(profile,"sourceId"),target=PublicProfile.Normalize(requested);var cache=Read(directory);object raw;
      var key=source!=""?source:target;var previous=cache.TryGetValue(key,out raw)?raw as System.Collections.Generic.Dictionary<string,object>:null;
      long at;bool recent=previous!=null&&Engine.Get(previous,"avatarData").StartsWith("data:image/png;base64,",System.StringComparison.Ordinal)&&Engine.Get(previous,"uid")==uid&&System.Int64.TryParse(Engine.Get(previous,"cachedAt"),out at)&&System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-at<21600000;
      profile["avatarData"]=recent?Engine.Get(previous,"avatarData"):ImageData(Engine.Get(profile,"avatar"));profile["cachedAt"]=System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      using(var mutex=new System.Threading.Mutex(false,"Local\\MetaAssistantAvatarCache")){
        bool held=false;try{try{held=mutex.WaitOne(5000);}catch(System.Threading.AbandonedMutexException){held=true;}if(!held)throw new System.Exception("Cache avatar đang bận.");
          cache=Read(directory);cache[key]=profile;cache[target]=profile;cache[uid]=profile;
          while(Engine.Json.Serialize(cache).Length>850000&&cache.Count>1){var oldest=cache.OrderBy(x=>{var p=x.Value as System.Collections.Generic.Dictionary<string,object>;long time;return p!=null&&System.Int64.TryParse(Engine.Get(p,"cachedAt"),out time)?time:0;}).First().Key;cache.Remove(oldest);}
          Write(directory,System.IO.Path.Combine(directory,FileName),Engine.Json.Serialize(cache));Publish(directory);
        }finally{if(held)mutex.ReleaseMutex();}
      }
      return profile;
    }
  }
}
