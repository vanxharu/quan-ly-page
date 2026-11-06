namespace MetaAssistantUpdater {
  public static class AvatarDiagnostics {
    static string Text(string value){
      value=System.Text.RegularExpressions.Regex.Replace(value??"",@"https?://[^\s]+","[link]",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
      value=System.Text.RegularExpressions.Regex.Replace(value,@"(?:access_token|authorization|cookie|token)\s*[:=]\s*[^\s,;]+","[ẩn]",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
      value=System.Text.RegularExpressions.Regex.Replace(value,@"EA[A-Za-z0-9_-]{20,}","[ẩn]");return value.Length>120?value.Substring(0,120):value;
    }
    public static System.Collections.Generic.Dictionary<string,object> Record(string root,System.Collections.Generic.Dictionary<string,object> input){
      var page=Engine.Get(input,"pageId");if(!System.Text.RegularExpressions.Regex.IsMatch(page,@"^\d{5,30}$"))throw new System.Exception("Page báo lỗi không hợp lệ.");
      var file=System.IO.Path.Combine(root,"inbox-avatar-diagnostic.json");var clean=new System.Collections.Generic.Dictionary<string,object>();object raw;
      var items=input.TryGetValue("items",out raw)?raw as System.Collections.IEnumerable:null;int count=0;
      if(items!=null)foreach(var value in items){
        if(count>=50)break;var item=value as System.Collections.Generic.Dictionary<string,object>;if(item==null)continue;var id=Engine.Get(item,"id");if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"^\d{5,30}$"))continue;
        var errors=new System.Collections.Generic.List<object>();object er;var source=item.TryGetValue("errors",out er)?er as System.Collections.IEnumerable:null;
        if(source!=null)foreach(var entry in source){if(errors.Count>=2)break;var e=entry as System.Collections.Generic.Dictionary<string,object>;if(e==null)continue;errors.Add(new System.Collections.Generic.Dictionary<string,object>{{"stage",Text(Engine.Get(e,"stage"))},{"code",Text(Engine.Get(e,"code"))},{"subcode",Text(Engine.Get(e,"subcode"))},{"message",Text(Engine.Get(e,"message"))}});}
        clean[page+":"+id]=new System.Collections.Generic.Dictionary<string,object>{{"pageId",page},{"id",id},{"hasPhoto",Engine.Get(item,"hasPhoto")=="True"},{"at",System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()},{"errors",errors}};count++;
      }
      using(var mutex=new System.Threading.Mutex(false,"Local\\MetaAssistantAvatarDiagnostic")){
        bool held=false;try{try{held=mutex.WaitOne(5000);}catch(System.Threading.AbandonedMutexException){held=true;}if(!held)throw new System.Exception("Báo lỗi đang bận.");
          var all=new System.Collections.Generic.Dictionary<string,object>();try{all=Engine.ReadJson(file);}catch{}foreach(var entry in clean)all[entry.Key]=entry.Value;
          while(all.Count>300||Engine.Json.Serialize(all).Length>180000){var key=all.OrderBy(e=>{var row=e.Value as System.Collections.Generic.Dictionary<string,object>;long time;return row!=null&&System.Int64.TryParse(Engine.Get(row,"at"),out time)?time:0;}).First().Key;all.Remove(key);}
          Engine.NoLinks(root);Engine.NoLinks(file);var temp=file+"."+System.Guid.NewGuid().ToString("N")+".tmp";System.IO.File.WriteAllText(temp,Engine.Json.Serialize(all),new System.Text.UTF8Encoding(false));if(System.IO.File.Exists(file))System.IO.File.Replace(temp,file,null);else System.IO.File.Move(temp,file);
        }finally{if(held)mutex.ReleaseMutex();}
      }
      return new System.Collections.Generic.Dictionary<string,object>{{"ok",true},{"received",count}};
    }
  }
}
