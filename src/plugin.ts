const through2 = require('through2')
import Vinyl = require('vinyl')
import PluginError = require('plugin-error');
const pkginfo = require('pkginfo')(module); // project package.json info into module.exports
const PLUGIN_NAME = module.exports.name;
import * as loglevel from 'loglevel'
const log = loglevel.getLogger(PLUGIN_NAME) // get a logger instance based on the project name
log.setLevel((process.env.DEBUG_LEVEL || 'warn') as log.LogLevelDesc)

import * as mailparser from 'mailparser'
//var mp = mailparser.MailParser; // low-level parser
var sp = mailparser.simpleParser // higher-level parser (easier to use, not as efficient)
const MailParser = require('mailparser').MailParser;
const StreamParser = require('./streamParser')


/** wrap incoming recordObject in a Singer RECORD Message object*/
function createRecord(recordObject:Object, streamName: string) : any {
  return {type:"RECORD", stream:streamName, record:recordObject}
}

/* This is a gulp-etl plugin. It is compliant with best practices for Gulp plugins (see
https://github.com/gulpjs/gulp/blob/master/docs/writing-a-plugin/guidelines.md#what-does-a-good-plugin-look-like ),
and like all gulp-etl plugins it accepts a configObj as its first parameter */
export function tapMime(configObj: any) {
  if (!configObj) configObj = {}
  //if (!configObj.columns) configObj.columns = true // we don't allow false for columns; it results in arrays instead of objects for each record

  // creating a stream through which each file will pass - a new instance will be created and invoked for each file 
  // see https://stackoverflow.com/a/52432089/5578474 for a note on the "this" param
const strm = through2.obj(
  async function (this: any, file: Vinyl, encoding: string, cb: Function) {
    const self = this
    let returnErr: any = null
    // let parser:any
    // parser = parseItem(configObj)
  
    // post-process line object
    const handleFile = (lineObj: any, _streamName : string): object | null => {
      // if (parser.options.raw || parser.options.info) {
        let newObj = createRecord(lineObj, _streamName)
        // if (lineObj.raw) newObj.raw = lineObj.raw
        // if (lineObj.info) newObj.info = lineObj.info
        lineObj = newObj
      // }
      // else {
      //   lineObj = createRecord(lineObj, _streamName)
      // }
      return lineObj
    }

    function newTransformer(streamName : string) {

      let transformer = through2.obj(); // new transform stream, in object mode
  
      // transformer is designed to follow csv-parse, which emits objects, so dataObj is an Object. We will finish by converting dataObj to a text line
      transformer._transform = function (dataObj: Object, encoding: string, callback: Function) {
        let returnErr: any = null
        try {
          let handledObj = handleFile(dataObj, streamName)
          if (handledObj) {
            let handledFile = JSON.stringify(handledObj)
            log.debug(handledFile)
            this.push(handledFile + '\n');
          }
        } catch (err) {
          returnErr = new PluginError(PLUGIN_NAME, err);
        }
  
        callback(returnErr)
      }
  
      return transformer
    }

    // set the stream name to the file name (without extension)
    let streamName : string = file.stem

    if (file.isNull()) {
      // return empty file
      return cb(returnErr, file)
    }
    else if (file.isBuffer()) {
      let parsed = await sp(file.contents)

      // parser(file.contents as Buffer, configObj, function(err:any, linesArray : []){
      //   // this callback function runs when the parser finishes its work, returning an array parsed lines 
      //   let tempLine: any
      //   let resultArray = [];
      //   // we'll call handleLine on each line
      //   for (let dataIdx in linesArray) {
      //     try {
      //       let lineObj = linesArray[dataIdx]
      //       tempLine = handleLine(lineObj, streamName)
      //       if (tempLine){
      //         let tempStr = JSON.stringify(tempLine)
      //         log.debug(tempStr)
      //         resultArray.push(tempStr);
      //       }
      //     } catch (err) {
      //       returnErr = new PluginError(PLUGIN_NAME, err);
      //     }
      //   }
      //   let data:string = resultArray.join('\n')
        let parsedMail = createRecord(parsed, "BufferModeStream")
        file.contents = Buffer.from(JSON.stringify(parsedMail))
        // we are done with file processing. Pass the processed file along
        log.debug('calling callback')    
        cb(returnErr, file);    
     //})

    }
    else if (file.isStream()) {
      file.contents = file.contents
      .pipe(new StreamParser(file.contents))
      
      .on('end', function () {

          // DON'T CALL THIS HERE. It MAY work, if the job is small enough. But it needs to be called after the stream is SET UP, not when the streaming is DONE.
          // Calling the callback here instead of below may result in data hanging in the stream--not sure of the technical term, but dest() creates no file, or the file is blank
          // cb(returnErr, file);
          // log.debug('calling callback')    

        log.debug('mime parser is done')
      })
        // .on('data', function (data:any, err: any) {
        //   log.debug(data)
        // })
      .on('error', function (err: any) {
        log.error(err)
        self.emit('error', new PluginError(PLUGIN_NAME, err));
      })
      .pipe(newTransformer(streamName))
      // after our stream is set up (not necesarily finished) we call the callback
      log.debug('calling callback')    
      cb(returnErr, file);
    }

  })

  return strm
}