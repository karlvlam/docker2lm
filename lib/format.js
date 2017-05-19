

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

function parseConfig(s){
    var o = JSON.parse(s);
    if (!o.apikey){
        new Error("Config: missing apikey!");
    }

    if (!o.custom_field){
        o.custom_field = {}
    }

    if (o.applog){
        if (!o.applog.label){
            o.applog.label = {};
        }
    }
    return o;
}

function getLabelNameMapping(labelConfig){
    var labelList = Object.keys(labelConfig);
    var ret = {};

    var m = labelList.map(function (o){
        if (labelConfig[o]['rename'] ){
            ret[o] = labelConfig[o]['rename'];
        }else{
            ret[o] = o;
        }
    });

    return ret;
}

function getLabel(labelMap, labels){
    var labelList = Object.keys(labelMap);
    var ret = {};

    var m = labelList.map(function (o){
        if (labels[o]){
            ret[labelMap[o]] = labels[o];
        }
    });

    return ret;
}


module.exports = {
    parseConfig: parseConfig,
    getLabel: getLabel,
    getLabelNameMapping: getLabelNameMapping,
}
