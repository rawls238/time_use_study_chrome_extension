/* jshint esversion:6 */

var count = 0;
var cleanup_freq = 120;


var alarmListener = function(alarm) {
    if (alarm.name == 'wdttg_alarm') {
        getActiveHosts(function(ge,gd) {
            if (!ge) {
                updateHostData(gd,function(ue,ud) {
                });
            }
        });
        /*jshint -W018 */
        if (!(count % cleanup_freq)) removeAncientData();
        count += 1;

        shouldSendData(function(shouldSend, dateToSend) {
          if (!shouldSend) {
            return;
          }
          return getData(dateToSend, dateToSend, 'active', sendDataToServer);
        });

    }
};

var shouldSendData = function(cb) { 
  var d = new Date();
  d2 = DateToDateString(d)
  d.setDate(d.getDate() - 1);
  d = DateToDateString(d)
  return chrome.storage.local.get(['last_sent'],function(sdata) {
    return cb(true, new Date(d2))
    if (!sdata || !sdata.last_sent) {
      chrome.storage.local.set({last_sent: DateToDateString(new Date())});
      return cb(false);
    }
    return cb(d != sdata.last_sent && d2 != sdata.last_sent);
   });
};

var agg_hostname = function(hostname) {
    var extracts = ['instagram.com', 'messenger.com', 'google.com', 'facebook.com', 'youtube.com', 'tiktok.com', 'reddit.com', 'pinterest.com', 'tumblr.com', 'amazon.com', 'twitter.com', '[Browser not focused]', 'newtab', 'extensions', 'pandora.com', 'spotify.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'twitch.tv', 'hbomax.com']
    for(var i = 0; i < extracts.length; i++) {
        if(hostname.includes(extracts[i])) {
            return hostname;
        }
    }
    return "other";
}

var getData = function(from, to, group, cb) {
    chrome.storage.local.get(['hostdata'],function(gd) {
      chrome.storage.sync.get(['aggregationLevel'], function(result) {
        aggregationLevel = result.aggregationLevel;
        timecounts = {}
        if (gd && gd.hostdata) {
            Object.keys(gd.hostdata).forEach(function(dtstr) {
                var ddate = new Date(dtstr);
                if ((ddate <= to) && (ddate >= from)) {
                    var hostcounts = gd.hostdata[dtstr][group];
                    Object.keys(hostcounts).forEach(function(hostname) {
                      /* this gets top level domain
                      var shostname = hostname;
                      var chunks = hostname.split(/\./);
                      var shostname = hostname;
                      if (chunks.length > 2) {
                        shostname = chunks.slice(-2).join('.');
                      }
                      */
                      var shostname = aggregationLevel == 'all'? hostname : agg_hostname(hostname);

                      if (timecounts[shostname]) {
                        timecounts[shostname] += hostcounts[hostname];
                      } else {
                        timecounts[shostname] = hostcounts[hostname];
                      }
                    });
                }
            });
            return cb(timecounts, from, group, aggregationLevel);
          }
        return cb('no_data', from, group, aggregationLevel);
      });
    });
};


var sendDataToServer = function(data, date, group, agg_level) {
  if (data == 'no_data') {
    return;
  }
  chrome.storage.sync.get(['experimentId'], function(result) {
    dat_to_send = []
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    for (var key of Object.keys(data)) {
      dat_to_send.push({ 'timestamp': Math.floor(new Date().getTime() / 1000), 'timezone': timezone, 'date': date.toLocaleDateString("en-US"), 'user_id': result.experimentId, 'track_type': group, 'website': key, 'agg_level': agg_level, 'time_spent': data[key] });
    }
    return fetch("[SERVER URL]", {
        method: 'POST',
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json, application/xml, text/plain, text/html, *.*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        body: 'response=' + JSON.stringify(dat_to_send)
    }).then(function(response) {
      chrome.storage.local.set({last_sent: DateToDateString(new Date())});
    }).catch((error) => {
      console.log(error);
    });
  });
}

var extractHostName = function(url) {
    var hostname;
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("://") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    return hostname;
};

var DateToDateString = function(idt) {
    var d = idt;
    d.setHours(0,0,0,0);
    return d.toISOString();
};

var removeAncientData = function() {
    console.log('removeAncientData');
    chrome.storage.local.get(['hostdata'],function(sdata) {
        if (sdata && sdata.hostdata) {
            var now = new Date();
            var m15d = new Date();
            m15d.setDate(now.getDate() - 15);
            Object.keys(sdata.hostdata).forEach(function(dtstr) {
                var then = new Date(dtstr);
                if (then <= m15d) {
                    delete sdata.hostdata[dtstr];
                }
            });
            chrome.storage.local.set({hostdata: sdata.hostdata});
        }
    });
};


var updateHostData = function(current,cb) {
   chrome.storage.local.get(['hostdata'],function(sdata) {
       if (!sdata || !sdata.hostdata) {
           sdata = { hostdata: {} };
       }
       var dtstr = DateToDateString(new Date());
       if (!sdata.hostdata[dtstr]) {
           sdata.hostdata[dtstr] = { showing: {}, active: {} };
       }
       Object.keys(current).forEach(function(groupname) {
           current[groupname].forEach(function(host) {
               if (!sdata.hostdata[dtstr][groupname][host]) {
                   sdata.hostdata[dtstr][groupname][host] = 1;
               } else {
                   sdata.hostdata[dtstr][groupname][host] += 1;
               }
           });
       });
       chrome.storage.local.set({hostdata: sdata.hostdata});
       cb(null,sdata);
   });
};

var getActiveHosts = function(cb) {
  chrome.windows.getAll({populate:true},function(windows){
    var rv = { showing: [], active: [] };
    windows.forEach(function(window){
      var window_showing  = window.state != 'minimized';
      window.tabs.forEach(function(tab){
        var host = extractHostName(tab.url);
        var showing = tab.active && window_showing;
        var active = showing && window.focused;
        if (showing) rv.showing.push(host);
        if (active) rv.active.push(host);
      });
    });
    if (!rv.showing.length) rv.showing.push('[Browser not showing]');
    if (!rv.active.length) rv.active.push('[Browser not focused]');
    return cb(null,rv);
  });
};

var period = 1.0;

var init = function() {
    chrome.alarms.onAlarm.addListener(alarmListener);
    chrome.alarms.create('wdttg_alarm', { delayInMinutes: period, periodInMinutes: period });
};


init();

