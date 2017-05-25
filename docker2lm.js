// USE node.js 7.6 or above

var tls = require('tls');
var Docker = require('dockerode');
//var Queue = require('./queue.js').Queue;
var stream = require('stream');
var fs = require('fs');
//var events = require('events');
//var eventEmitter = require('events').EventEmitter;
var format = require('./lib/format.js');

var log = function(message){
    console.log('[' + new Date().toISOString() + '] ' + message);
}

/* Use ENV VAR as configuration
{
    "apikey": "9b35f0c3-6c01-4690-bf85-0c5dc7f944c0"
    "custom_field": {"type": "k8s", "env": "prod", "user": "John Doe"},
    "applog": {
        "label": {
            "io.kubernetes.pod.namespace": { "rename": "ns"}
            "io.kubernetes.container.name": { "rename": "container"}
        }
    },
    "stats": {},
    "event": {},
}
*/
const config = format.parseConfig(process.env['DOCKER_LM_CONFIG']); //ENV VAR 
console.log(config);
const API_KEY = config['apikey'];
const CUSTOM_FIELD = config['custom_field'];
const LABEL_MAP = format.getLabelNameMapping(config['applog']['label']);

var containerPool = {}; // keep a connection pool of docker api

var apiSocket = null; // socket object to Logmatic
var dockerEvtSocket = null; // docker event listener socket

var docker = new Docker({socketPath: '/var/run/docker.sock'}); // unix socket

const LOG_TIME = 5000; // query docker api time interval
const EVENT_TIME = 5000; // query docker event time interval
const STATS_TIME = 30000; // get docker stats time interval 
var logTimer = null;
var eventTimer = null;
var statsTimer = null;

/* STARTS */
if (!config.applog){
    console.log('Nothing is going to shipped, exit!');
    console.log(' - Please config "applog" object');
    process.exit(1);
}

try{
    connectAPI();
}catch(err){
    console.log(err);
}

// run GC every 10 min 
setInterval(function(){
    if (global.gc){
        global.gc();
        log("[GC] Done!");
        return;
    }
    log("[GC] no GC, run with --expose-gc ?");

}, 600000);




/*
* 
* Change docker log buffer to json object:
* {
* 
*     type: 'docker-log',
*     timestamp: "unix time in ISO String",
*     message: "log content",
* }
* 
* */
function dockerLogToObj(chunk){
    try{
        var s = chunk.toString();
        return { 
            marker: CUSTOM_FIELD,
            type: 'docker-log',
            timestamp: new Date(s.substr(0, 30)).toISOString(),
            message: s.substr(31).trim()
        }
    }catch(err){
    }
}

function dockerStatsToObj(stats){
    try{
        var t = stats['read'];
        delete stats['read'];
        delete stats['preread'];
        return { 
            marker: CUSTOM_FIELD,
            type: 'docker-stats',
            timestamp: new Date(t.substr(0, 30)).toISOString(),
            stats: stats, 
        }
    }catch(err){
    }
}

async function logDockerStats(){
    // get all containers
    log("test");
    var containers = await getContainers();

    //var c = containers[0];
    containers.map(async function(c){
        var a = await docker.getContainer(c.Id);
        var s = await a.stats({stream:false});
        api_write(API_KEY, JSON.stringify(dockerStatsToObj(s)));
    });
   
    
};


/*
* 
*  1. keep connected with Logmatic TCP api
*  2. keep log the missed containers (in case docker event api disconnected)
*  3. keep connected with docker event api
* 
* */
function connectAPI(){
    try{
        if (apiSocket.ready) {
            return;
        }
    }catch(err){}

    log('Connecting Logmatic...')
    apiSocket = tls.connect(10515, "api.logmatic.io", {}, function () {
        log("Logmatic connected!")
        if (apiSocket.authorized) {
            apiSocket.setEncoding('utf8');
            apiSocket.setNoDelay();

            apiSocket.ready = true;
            log("Logmatic authorized!");

            logContainers();
            listenDockerEvent();
            logDockerStats();

            // keep log skipped containers
            clearInterval(logTimer);
            logTimer = setInterval(logContainers, LOG_TIME); 

            // reconnect the docker event API
            clearInterval(eventTimer);
            eventTimer = setInterval(listenDockerEvent, EVENT_TIME);

            clearInterval(statsTimer);
            statsTimer = setInterval(logDockerStats, STATS_TIME); 

        }else{
            log("Logmatic failed!");
        }

    });

    // Just reconnect!!!
    apiSocket.on('error', function(){
        log('Logmatic connection error!');
    });

    apiSocket.on('close', function(){
        log('Logmatic connection closed!');
    });

    apiSocket.on('end', function(){
        log('Logmatic connection ended! reconnect...');
        apiSocket = null;
        connectAPI();
    });


}

function api_write(token, message){
    if (!apiSocket.ready) return;
    apiSocket.write(token + ' ' + message + '\n'); 
}

async function logContainers(id, since){
    // get all containers
    var containers = await getContainers();
    containers.map(function(c){
        //log(JSON.stringify(c,null,2));

        if (id && since && c['Id'] === id){
            _logContainer(c, since);
        }
        _logContainer(c);
    });
    
};

function _logContainer(c, since){
    // stop if already exist in connection pool
    if (containerPool[c.Id]){
        return;
    }

    var labels = format.getLabel(LABEL_MAP, c['Labels']);

    listenDockerLog({id: c.Id, since: since, labels: labels});

}

async function getContainers(){
    try {
        var res = await docker.listContainers({});
    }catch(err){
        log(err)
        return []
    }
    return res;
}

function listenDockerLog(info){
    // stop if exists
    if (containerPool[info.id]){
        return;
    }

    var container = docker.getContainer(info.id);
    var logStream = new stream.PassThrough();
    containerPool[info.id] = logStream; // store socket object to the pool
    logStream.info = info; // store info for reference
    // TODO: may also need to close the "stream" ?
    logStream.on('data', function(chunk){
        var l = dockerLogToObj(chunk); 
        // add the Labels to the real log object
        try{
            // fire the log!
            l['labels'] = info['labels'];
            api_write(API_KEY, JSON.stringify(l));
        }catch(err){
            log('LOG_ERROR: ' + err);
        }
    });

    logStream.on('end', function(){
        log('LogSteam ended! ' + logStream.info.id);
    })
    logStream.on('error', function(){
        log('LogSteam error! ' + logStream.info.id);
    })

    logStream.on('close', function(){
        log('LogSteam closed! ' + logStream.info.id);
    })

    if (!info['since']){
        info['since'] = Math.floor(new Date().getTime()/1000) - 1; 
    }

    container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        // unixtime in SEC, very on99!
        since: info['since'], 
    }, function(err, stream){
        if(err) {
            log(err);
            return;
        }

        container.modem.demuxStream(stream, logStream, logStream);
        log('Container log stream connected! ' + logStream.info.id);

        stream.on('error', function(err){
            log('Container stream error! ' + logStream.info.id);
            log(err);
        });

        stream.on('end', function(){
            log('Container stream ended! "' + logStream.info.id );
            delete containerPool[logStream.info.id]; // remove socket object from the pool
            logStream.end('!stop!');
        });

        stream.on('close', function(){
            log('Container stream closed! "' + logStream.info.id );
            log('Container "' + logStream.info.id +'" stopped!');
            delete containerPool[logStream.info.id];
            logStream.end('!stop!');
        });

    });
}


/* Docker events sample
{
    "status": "start",
    "id": "451368a754f26702c12dbc44cfc7ac7096f775c57415522bb57005b0881de834",
    "from": "quay.io/onesky/dummy-log",
    "Type": "container",
    "Action": "start",
    "Actor": {
        "ID": "451368a754f26702c12dbc44cfc7ac7096f775c57415522bb57005b0881de834",
        "Attributes": {
            "image": "quay.io/onesky/dummy-log",
            "name": "optimistic_spence"
        }
    },
    "time": 1489729976,
    "timeNano": 1489729976229354000
}


{
    "status": "die",
    "id": "9c84c4fba102a75ad1e501b78fa80338e32fc39d356d7421f23e49d80cc0212b",
    "from": "quay.io/onesky/dummy-log",
    "Type": "container",
    "Action": "die",
    "Actor": {
        "ID": "9c84c4fba102a75ad1e501b78fa80338e32fc39d356d7421f23e49d80cc0212b",
        "Attributes": {
            "exitCode": "0",
            "image": "quay.io/onesky/dummy-log",
            "name": "nervous_northcutt"
        }
    },
    "time": 1489730101,
    "timeNano": 1489730101166362600
}

*/
function listenDockerEvent(){
    try{
        if (dockerEvtSocket.ready) {
            return;
        }
    }catch(err){}

    docker.getEvents({},function(err, res){
        if (err){
            console.log(err);
            return;
        }
        dockerEvtSocket = res;
        dockerEvtSocket.ready = true;
        res.on('data', function(data){

            var event = JSON.parse(data.toString());
            /* 
             * Only 2 events will be considered:
             * 1. container -> start (just log that container)
             * 2. container -> die (log only)
             */
            if (event['Type'] !== 'container') {
                return;
            }

            if (event['status'] === 'start') {
                log('[DOCKER_EVENT] ' + event['id']  + ' '+  event['status'] );
                logContainers(event['id'], event['time']);
                return;
            }

            if (event['status'] === 'die') {
                log('[DOCKER_EVENT] ' + event['id']  + ' '+  event['status'] );
                return;
            }
        })

        res.on('error', function(){
            log('[ERROR] Listen Docker Event error.');

        })
        res.on('end', function(){
            log('[ERROR] Listen Docker Event connection end.');
            dockerEvtSocket = null;
            listenDockerEvent();
        })
        res.on('close', function(){
            log('[ERROR] Listen Docker Event connection closed.');
            dockerEvtSocket = null;
            listenDockerEvent();
        })

        log('Listening Docker Events...');
    })

}



