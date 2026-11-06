namespace MetaAssistantUpdater {
  // Public HTML only. No Facebook cookies, browser storage or login sessions are read.
  public static class PublicProfile {
    public static string Normalize(string value) {
      value=(value??"").Trim();if(System.Text.RegularExpressions.Regex.IsMatch(value,@"^\d{5,30}$"))return "https://www.facebook.com/"+value;
      System.Uri uri;if(!System.Uri.TryCreate(value,System.UriKind.Absolute,out uri)||uri.Scheme!="https"||uri.Port!=443||uri.UserInfo!=""||!new[]{"facebook.com","www.facebook.com","m.facebook.com"}.Contains(uri.Host))throw new System.Exception("Chỉ dùng link trang cá nhân công khai trên facebook.com.");
      var slug=uri.AbsolutePath.Trim('/');
      if(slug=="profile.php"){var query=System.Web.HttpUtility.ParseQueryString(uri.Query);var id=query["id"]??"";if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"^\d{5,30}$"))throw new System.Exception("Link chưa có UID hợp lệ.");return "https://www.facebook.com/"+id;}
      if(!System.Text.RegularExpressions.Regex.IsMatch(slug,@"^[a-zA-Z0-9.]{3,100}$")||new[]{"login","checkpoint","help","privacy","settings","photo.php","l.php","home.php","watch","reel","groups","pages","recover","dialog","share"}.Contains(slug.ToLowerInvariant()))throw new System.Exception("Cần link trang cá nhân, không dùng trang đăng nhập hoặc bài đăng.");
      return "https://www.facebook.com/"+slug;
    }
    public static System.Collections.Generic.Dictionary<string,object> Parse(string html,string requested) {
      requested=Normalize(requested);var meta=new System.Collections.Generic.Dictionary<string,string>();
      foreach(System.Text.RegularExpressions.Match tag in System.Text.RegularExpressions.Regex.Matches(html,@"<meta\b[^>]*>",System.Text.RegularExpressions.RegexOptions.IgnoreCase)){
        var attrs=new System.Collections.Generic.Dictionary<string,string>(System.StringComparer.OrdinalIgnoreCase);
        foreach(System.Text.RegularExpressions.Match a in System.Text.RegularExpressions.Regex.Matches(tag.Value,@"([\w:-]+)\s*=\s*(?:""([^""]*)""|'([^']*)')"))attrs[a.Groups[1].Value]=System.Net.WebUtility.HtmlDecode(a.Groups[2].Success?a.Groups[2].Value:a.Groups[3].Value);
        string key,content;if((attrs.TryGetValue("property",out key)||attrs.TryGetValue("name",out key))&&attrs.TryGetValue("content",out content))meta[key]=content;
      }
      var ids=new System.Collections.Generic.HashSet<string>();foreach(var key in new[]{"al:android:url","al:ios:url"}){string value;if(meta.TryGetValue(key,out value)){var match=System.Text.RegularExpressions.Regex.Match(value,@"^fb://profile(?:/|\?id=)(\d{5,30})(?:$|[?&])");if(match.Success)ids.Add(match.Groups[1].Value);}}
      if(ids.Count!=1)throw new System.Exception("Trang công khai chưa trả UID xác minh. Cần liên kết Facebook của đúng khách; không đổi PSID thành UID theo phỏng đoán.");
      var uid=ids.First();string image,title,canonical;if(!meta.TryGetValue("og:image",out image)||!meta.TryGetValue("og:title",out title)||!meta.TryGetValue("og:url",out canonical))throw new System.Exception("Trang công khai chưa trả đủ ảnh và danh tính khách.");
      System.Uri pic;if(!System.Uri.TryCreate(image,System.UriKind.Absolute,out pic)||pic.Scheme!="https"||pic.UserInfo!=""||pic.Port!=443||!pic.Host.EndsWith(".fbcdn.net",System.StringComparison.OrdinalIgnoreCase)||pic.AbsolutePath.Contains("rsrc.php")||System.Text.RegularExpressions.Regex.IsMatch(pic.Query,@"(?:[?&])(access_token|token|authorization)=",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new System.Exception("Ảnh công khai không hợp lệ.");
      canonical=Normalize(canonical);var requestedSlug=new System.Uri(requested).AbsolutePath.Trim('/');if(System.Text.RegularExpressions.Regex.IsMatch(requestedSlug,@"^\d+$")&&requestedSlug!=uid)throw new System.Exception("ID hội thoại không trùng UID trang công khai. Cần link Facebook để xác minh đúng khách.");
      if(!System.Text.RegularExpressions.Regex.IsMatch(requestedSlug,@"^\d+$")&&!System.String.Equals(requested,canonical,System.StringComparison.OrdinalIgnoreCase))throw new System.Exception("Facebook chuyển sang trang khác; chưa nhận ảnh để tránh gán nhầm khách.");
      return new System.Collections.Generic.Dictionary<string,object>{{"ok",true},{"uid",uid},{"name",title},{"profileUrl",canonical},{"avatar",pic.AbsoluteUri}};
    }
    public static System.Collections.Generic.Dictionary<string,object> Read(string value) {
      var requested=Normalize(value);var url=requested;System.Net.ServicePointManager.SecurityProtocol|=System.Net.SecurityProtocolType.Tls12;
      for(int redirects=0;redirects<4;redirects++){
        var req=(System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);req.AllowAutoRedirect=false;req.Timeout=12000;req.ReadWriteTimeout=12000;req.UserAgent="MetaAssistant/2.4.1";
        using(var response=(System.Net.HttpWebResponse)req.GetResponse()){
          if(new[]{301,302,303,307,308}.Contains((int)response.StatusCode)){var next=new System.Uri(new System.Uri(url),response.Headers["Location"]??"");url=Normalize(next.AbsoluteUri);continue;}
          if(response.StatusCode!=System.Net.HttpStatusCode.OK)throw new System.Exception("Trang Facebook công khai chưa sẵn sàng; không tự đi qua đăng nhập.");
          using(var stream=response.GetResponseStream())using(var memory=new System.IO.MemoryStream()){var buffer=new byte[32768];int n;while((n=stream.Read(buffer,0,buffer.Length))>0){if(memory.Length+n>2097152)throw new System.Exception("Trang công khai vượt giới hạn dữ liệu.");memory.Write(buffer,0,n);}return Parse(System.Text.Encoding.UTF8.GetString(memory.ToArray()),requested);}
        }
      }
      throw new System.Exception("Trang công khai chuyển hướng quá nhiều lần.");
    }
  }
}
