'use strict';

const {app, dialog, BrowserWindow, ipcMain} = require('electron');
const EventEmitter = require('events');
const dgram = require('dgram');
const fs = require('fs');

// For exposing available ip addresses to the user
const os = require('os');
const ifaces = os.networkInterfaces();

// Additional needed packages
const Uint64BE = require("int64-buffer").Uint64BE;
const crc32 = require('buffer-crc32');

try {
  // Load environmental variables
  require('dotenv').load()

  if (process.env.NODE_ENV === "development") {
    let hotReloadServer = require('hot-reload-server')
    let webpackConfig = require('./webpack.config.dev')
    let webpack = require('webpack');

    webpack(webpackConfig, function (err, data) {
      if (err) console.log(err);
    });

    hotReloadServer(webpackConfig, {
      publicPath: '/dist',
    }).start()
  }
} catch (e){
  //console.log(e);
}

// Macimum count of repeats for re-sending message
const MAX_REPEATS = 3;

// Maximum packet size
const MAX_PACKET_SIZE = 65535;
// Size of the UDP header
const UDP_HEADER_SIZE = 20;
// Size of IP header
const IP_HEADER_SIZE = 8;
// Maximum UDP data size
const MAX_UDP_PAYLOAD = MAX_PACKET_SIZE - UDP_HEADER_SIZE - IP_HEADER_SIZE;
// Size of reference to current and next frame (each is using 8 bytes)
const FRAME_REFERENCE_SIZE = 8;
// Message type length
const MESSAGE_TYPE_SIZE = 1;
// Payload size
const PAYLOAD_LENGHT_SIZE = 2;
// CRC32 length
const CRC32_LENGHT = 4;
// Header Size
const PROTOCOL_HEADER_SIZE = 2 * FRAME_REFERENCE_SIZE + MESSAGE_TYPE_SIZE + PAYLOAD_LENGHT_SIZE + CRC32_LENGHT;
// Maximum size of Payload
const MAX_PAYLOAD_SIZE = MAX_UDP_PAYLOAD - PROTOCOL_HEADER_SIZE;

const Uint64BEZero = new Uint64BE(0);

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var win;
var sentMessages = [], receivedMessages = [];
var serverConf = null;
var ServerClient;
var udpCommunicatorEmitter = new EventEmitter();


function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({ width: 800, height: 600 });

  // and load the index.html of the app.
  win.loadURL("file://" + __dirname + "/app/index.html");

  // Open the DevTools.
  // win.webContents.openDevTools();

  // Handle requests from electron window
  ipcMain.on('get-available-addresses', _onGetAvailableAddresses)
  ipcMain.on('start-server-client-udp', _startUDPServerClient);
  ipcMain.on('stop-server-client-udp', _stopUDPServerClient);
  ipcMain.on('send-data', _sendData);
  ipcMain.on('save-file', _openSaveDialog);

  ipcMain.on('get-server-conf', _onGetServerConf);
  ipcMain.on('get-message-details', _onGetMessageDetails);

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
    if (ServerClient != null)
      ServerClient.close();
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow();
  }
});

function _onGetAvailableAddresses(e) {
  var addresses = [];

  Object.keys(ifaces).forEach(function (ifname) {
    var alias = 0;
    ifaces[ifname].forEach(function (iface) {
      if ('IPv4' !== iface.family) {
        // skip over non-ipv4 addresses
        return;
      }

      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        addresses.push(iface.address);
      } else {
        // this interface has only one ipv4 adress
        addresses.push(iface.address);
      }
      ++alias;
    });
  });
  e.returnValue = addresses.length > 0 ? addresses : null;
}

var startEvent = null;
// Start UDP ServerClient
function _startUDPServerClient(event, config) {
  if (config == null || config.address == null || config.port == null)
    return;

  if (ServerClient != null) {
    ServerClient.close();
    ServerClient = null;
  }

  ServerClient = dgram.createSocket('udp4');

  ServerClient.on('error', (err) => {
    startEvent.returnValue = event.returnValue = { type: 'ERROR', message: '${err.stack}' };
    console.log(`server error:\n${err.stack}`);
    startEvent = null;
    ServerClient.close();
  });

  ServerClient.on('message', _receiveData);

  ServerClient.on('listening', () => {
    var address = ServerClient.address();
    console.log(`Server listening ${address.address}:${address.port}`);
    serverConf = {
      address: address.address,
      port: address.port
    }
  });

  ServerClient.on('close', () => {
    console.log(`Server closed`);
    serverConf = null;
  });

  try {
    startEvent = event;
    ServerClient.bind(config.port, config.address, (err) => {
      startEvent = null;
      if (err) {
        event.returnValue = { type: "ERROR", message: err }
        return;
      }
      event.returnValue = { address: ServerClient.address().address, port: ServerClient.address().port };
    });
  } catch (ex) {
    event.returnValue = { type: "ERROR", message: ex };
  }
}

// Stop UDP ServerClient
function _stopUDPServerClient(event, args) {
  try {
    ServerClient.close();
    ServerClient = null;
    event.returnValue = null;
  } catch (ex) {
    event.returnValue = ex;
  }
}

function _onGetServerConf(e) {
  e.returnValue = serverConf;
}

function _onGetMessageDetails(e, messageID) {
  e.returnValue = receivedMessages[messageID].datagrams;
}

function _openSaveDialog(e, messageID) {
  var message = receivedMessages[messageID];
  dialog.showSaveDialog({ title: message.data.name, defaultPath: message.data.name }, function (fileName) {
    if (fileName === undefined) {
      console.log("You didn't save the file");
      e.returnValue = { type: "ERROR", message: "You didn't save the file" };
      return;
    }
    // fileName is a string that contains the path and filename created in the save file dialog.  
    fs.writeFile(fileName, Buffer.from(message.data.data), function (err) {
      if (err) {
        console.log("An error ocurred creating the file " + err.message);
        e.returnValue = { type: "ERROR", message: "An error ocurred creating the file " + err.message };
      }

      console.log("The file has been succesfully saved");
      e.returnValue = { type: "SUCCESS", message: "The file has been succesfully saved" };
    });
  });
}

//**********************************************************************************************************************
//
// SEND RECEIVE DATA// SEND RECEIVE DATA// SEND RECEIVE DATA// SEND RECEIVE DATA// SEND RECEIVE DATA// SEND RECEIVE DATA
//
//**********************************************************************************************************************

// Event listeners
var onConnectionEstablishResult = null, onDatagramReceived = null;
var messageReceived = false, sendingFile = false;
/*
"args":
{
  address: string,
  port: Number,
  fragmnetSize: Number,
  message: String(message plain text),
  data: String(data encoded in base64)
}
*/
function _sendData(event, args) {
  var maxPayloadSize = MAX_PAYLOAD_SIZE;

  // Check if the request does not contain empty fields
  if (args.address == "" || args.address == null) {
    console.log("ERROR: Address field cannot be empty!");
    event.returnValue = { type: "ERROR", message: "Address field cannot be empty!" };
    return;
  } else if (args.port == "" || args.port == null) {
    console.log("ERROR: Port field cannot be empty!");
    event.returnValue = { type: "ERROR", message: "Port field cannot be empty!" };
    return;
  } else if ((args.message == "" || args.message == null) && (args.data == {} || args.data == null)) {
    console.log("ERROR: No data to send specified!");
    event.returnValue = { type: "ERROR", message: "No data to send specified!" };
    return;
  } else {
    // If the fragment size is specified and is not out of range, set it
    if (args.fragmentSize != "" &&
      args.fragmentSize != null &&
      args.fragmentSize != NaN &&
      parseInt(args.fragmentSize) != 0 &&
      parseInt(args.fragmentSize) <= MAX_PAYLOAD_SIZE) {
      maxPayloadSize = parseInt(args.fragmentSize);
    }

    onConnectionEstablishResult = (successful) => {
      if (!successful) {
        console.log("ERROR: Connection could not be established");
        event.returnValue = { type: "ERROR", message: "Connection could not be established" };
        udpCommunicatorEmitter.removeListener('establish_connection', onConnectionEstablishResult);
        return;
      } else {
        console.log("Connection established!");
      }

      var startIndex = 0, count = maxPayloadSize, message = args.message, data = "", counter = 1, sendAgainCount = 0, fileInfo = null;
      var counterBuffer, counterPlusBuffer, typeBuffer, payloadLengthBuffer, payloadBuffer, crc32Buffer, datagramBuffer;
      var messageTimeout = null;
      var sentDatagrams = [];

      // Load file
      if (args.data != {} && args.data != null) {
        let file = args.data;
        try {
          let buffer = fs.readFileSync(file.path);
          // If the file could not be loaded
          if (!buffer)
            return;
          // Make a fileInfo Object
          fileInfo = {
            name: file.name,
            size: file.size,
            data: buffer
          }
          data = JSON.stringify(fileInfo);
        } catch (err) {
          console.log("An error ocurred reading the file :" + err.message);
          event.returnValue = { type: "ERROR", message: "An error ocurred reading the file :" + err.message };
          return;
        }
      }

      // Print the message that is going to be sent and the maximumm payload size
      console.log("message.length: " + message.length);
      console.log("data.size: " + data.length);
      console.log("maxPayloadSize: " + maxPayloadSize);

      onDatagramReceived = (datagramReceived) => {
        // Clear timeout so there is no worthless call to the function
        if (messageTimeout != null)
          clearTimeout(messageTimeout);
        // Set the default flag
        sendingFile = false;

        if ((message.length + data.length) == startIndex && datagramReceived.compare(counterPlusBuffer) == 0 && messageReceived) {
          console.log("SUCCESS: Sending message was successful");
          event.returnValue = { type: "SUCCESS", message: "Sending message was successful" };
          udpCommunicatorEmitter.removeListener('datagram_received', onDatagramReceived);
          udpCommunicatorEmitter.removeListener('establish_connection', onConnectionEstablishResult);
          messageReceived = false;
          return;
        }

        // If datagram was not received correctly yet and it is not the first one, send it one more time
        if (counter != 1 && datagramReceived.compare(Uint64BEZero.toBuffer()) == 0) {
          if (sendAgainCount >= MAX_REPEATS) {
            console.log("ERROR: Sending failed, due to the many failed attempts of sending datagram");
            event.returnValue = { type: "ERROR", message: "Sending failed, due to the many failed attempts of sending datagram" };
            udpCommunicatorEmitter.removeListener('datagram_received', onDatagramReceived);
            udpCommunicatorEmitter.removeListener('establish_connection', onConnectionEstablishResult);
            return;
          }
          startIndex -= count;
          counter--;
          sendAgainCount++;
        } else {
          sendAgainCount = 0;
        }
        // If the buffer was not correctly received the receiver requests the same datagram again
        if (counter != 1 && datagramReceived.compare(counterBuffer) == 0) {
          startIndex -= count;
          counter--;
        }

        // If the message is shorter than the datagram size calculate the count the size needed
        if (args.message.length < (startIndex + count)) {
          count = args.message.length - startIndex;
        }

        // If the message was already sent, start sending a file
        if (count <= 0 && data.length > 0) {
          sendingFile = true;

          count = maxPayloadSize;
          if (args.message.length + data.length < (startIndex + count)) {
            count = args.message.length + data.length - startIndex;
          }
        }
        // Create Buffers
        counterBuffer = new Uint64BE(counter).toBuffer();
        // If this is the last datagram poiner to next is 0
        if (message.length + data.length == (startIndex + count)) {
          counterPlusBuffer = Uint64BEZero.toBuffer();
          sentMessages.push({ message: receivedMessage, data: fileInfo, address: args.address, port: args.port, datagrams: sentDatagrams });
        } else {
          counterPlusBuffer = new Uint64BE(counter + 1).toBuffer();
        }
        if (!sendingFile) {
          // Type 0 means ordinal datagram with message
          typeBuffer = Buffer.from(_intTo8BytesArray(0));
        } else {
          // Type 2 means sending a file
          typeBuffer = Buffer.from(_intTo8BytesArray(2));
        }
        payloadLengthBuffer = Buffer.from(_intTo16BytesArray(count));
        if (!sendingFile) {
          payloadBuffer = Buffer.from(args.message.substring(startIndex, startIndex + count));
        } else {
          payloadBuffer = Buffer.from(data.substring(startIndex - args.message.length, startIndex - args.message.length + count));
        }
        // Create final buffer
        datagramBuffer = Buffer.concat([counterBuffer, counterPlusBuffer, typeBuffer, payloadLengthBuffer, payloadBuffer]);
        crc32Buffer = crc32(datagramBuffer);
        // If the error fragment must be sent, set it to last one
        if (message.length + data.length == (startIndex + count) && args.error) {
          crc32Buffer[3] += 1;
          args.error = false;
        }
        datagramBuffer = Buffer.concat([datagramBuffer, crc32Buffer]);
        datagramReceived = Uint64BEZero.toBuffer();
        // Send it to a client
        ServerClient.send(datagramBuffer, args.port, args.address);
        sentDatagrams.push(datagramBuffer);
        // Calculate the length of the next datagram message
        startIndex = startIndex + count;
        // Increase datagram identifier
        counter++;
        // Set timeout for receiving next message
        messageTimeout = setTimeout(() => {
          udpCommunicatorEmitter.emit('datagram_received', Uint64BEZero.toBuffer());
        }, 1000);
      }

      udpCommunicatorEmitter.addListener('datagram_received', onDatagramReceived);
      udpCommunicatorEmitter.emit('datagram_received', Uint64BEZero.toBuffer());
    }
    // Enable listener and establish connection to the server
    udpCommunicatorEmitter.addListener('establish_connection', onConnectionEstablishResult);
    _establishConnection(args.address, args.port);
  }
}

var receivedMessage, receivedDataStringified, receivedDatagrams, lastReceivedDatagramID = null;

function _receiveData(msg, rinfo) {
  // Read received message
  var msgBuffer = Buffer.from(msg);

  var currentDatagramIdentifier = new Uint64BE(msgBuffer.slice(0, 8), 0);
  var nextDatagramIdentifier = new Uint64BE(msgBuffer.slice(8, 16), 0);
  var messageType = _BytesArrayToInt(msgBuffer.slice(16, 17), 0);

  // 0: Received regular text message
  // 2: Receive file
  if (messageType == 0 || messageType == 2) {
    // Check if due to the delay in connection the message was not received more than once
    if (lastReceivedDatagramID) {
      if (lastReceivedDatagramID.toBuffer().compare(currentDatagramIdentifier.toBuffer()) == 0 && nextDatagramIdentifier != 0) {
        receivedDatagrams.push({ id: currentDatagramIdentifier, crc32: true, receivedMultiple: true });
        console.log("INFO: DATAGRAM RECEIVED MULTIPLE TIMES");
        ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(1)), nextDatagramIdentifier.toBuffer()]), rinfo.port, rinfo.address);
        return;
      }
    }

    if (!lastReceivedDatagramID || lastReceivedDatagramID.toBuffer().compare(currentDatagramIdentifier.toBuffer()) != 0) {
      if (currentDatagramIdentifier == 1) {
        receivedMessage = "";
        receivedDataStringified = "";
        receivedDatagrams = [];
        console.log("ERASED: receivedMessage and receivedDatagrams");
      }
    }

    lastReceivedDatagramID = currentDatagramIdentifier;
    // Read the message length
    var messageLength = _BytesArrayToInt(msgBuffer.slice(17, 19), 0);
    // Check CRC32
    var payloadBuffer = msgBuffer.slice(0, 19 + messageLength);
    var partialMessage = msgBuffer.slice(19, 19 + messageLength);
    var crc32BufferCalculated = crc32(payloadBuffer);
    var crc32BufferReceived = msgBuffer.slice(19 + messageLength);
    if (crc32BufferCalculated.compare(crc32BufferReceived) != 0) {
      // Request message again
      receivedDatagrams.push({ id: currentDatagramIdentifier, crc32: false, receivedMultiple: false });
      ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(1)), currentDatagramIdentifier.toBuffer()]), rinfo.port, rinfo.address);
    } else {
      receivedDatagrams.push({ id: currentDatagramIdentifier, crc32: true, receivedMultiple: false });
      if (messageType == 0)
        receivedMessage += partialMessage;
      else
        receivedDataStringified += partialMessage;

      if (nextDatagramIdentifier == 0) {
        lastReceivedDatagramID = null;
        // Send successful response
        ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(200)), nextDatagramIdentifier.toBuffer()]), rinfo.port, rinfo.address);
        var id = receivedMessages.push({ message: receivedMessage, data: receivedDataStringified.length > 0 ? JSON.parse(receivedDataStringified) : null, address: rinfo.address, port: rinfo.port, datagrams: receivedDatagrams }) - 1;
        console.log(JSON.stringify({
          type: "MESSAGE_RECEIVED",
          id: id,
          message: receivedMessage,
          data: receivedMessages[id].data ? { name: receivedMessages[id].data.name, size: receivedMessages[id].data.size } : null,
          address: rinfo.address,
          port: rinfo.port
        }));
        win.webContents.send('message_received', {
          type: "MESSAGE_RECEIVED",
          id: id,
          message: receivedMessage,
          data: receivedMessages[id].data ? { name: receivedMessages[id].data.name, size: receivedMessages[id].data.size } : null,
          address: rinfo.address,
          port: rinfo.port
        });
      } else {
        // Request next message
        ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(1)), nextDatagramIdentifier.toBuffer()]), rinfo.port, rinfo.address);
      }
    }
  }
  // 1: Request for next dataram
  else if (messageType === 1) {
    var datagramReceived = new Uint64BE(msgBuffer.slice(17, 25), 0).toBuffer();
    udpCommunicatorEmitter.emit('datagram_received', datagramReceived);
  }
  else if (messageType === 200) {
    var datagramReceived = new Uint64BE(msgBuffer.slice(17, 25), 0).toBuffer();
    messageReceived = true;
    udpCommunicatorEmitter.emit('datagram_received', datagramReceived);
  }
  // 254: Response to request to establish connection, means success
  else if (messageType === 254) {
    connectionEstablished = true;
  }
  // 255: Request to establish connection
  else if (messageType == 255) {
    ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(254))]), rinfo.port, rinfo.address);
  }
}

//*****************************************************************************************************************
//
// CONNECTIONS HANDLERS// CONNECTIONS HANDLERS// CONNECTIONS HANDLERS// CONNECTIONS HANDLERS// CONNECTIONS HANDLERS
//
//*****************************************************************************************************************

var connectionEstablished = false;
var lastEstablishedAddress = null;
var lastEstablishedPort = null;
var handleConnectionInterval;

function _establishConnection(address, port) {
  // Check if the connection is established if not do so
  if (lastEstablishedAddress != address || lastEstablishedPort != port || !connectionEstablished) {
    // If the connection is already established halt it
    if (connectionEstablished) {
      _haltConnection();
    }

    var not_received = 0, counter = 0;
    console.log("Establishing connection to " + address + ":" + port);
    ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(255))]), port, address);
    var establishConnectionInterval = setInterval(function () {
      if (connectionEstablished) {
        lastEstablishedAddress = address;
        lastEstablishedPort = port;
        _maintainConnection(address, port);
        udpCommunicatorEmitter.emit('establish_connection', true);
        clearInterval(establishConnectionInterval);
      }
      else {
        counter++;
        if (counter >= 1000) {
          ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(255))]), port, address);
          not_received++;
          counter = 0;
          if (not_received >= MAX_REPEATS) {
            udpCommunicatorEmitter.emit('establish_connection', false);
            clearInterval(establishConnectionInterval);
          }
        }
      }
    }, 1);
  }
  else {
    udpCommunicatorEmitter.emit('establish_connection', true);
  }
}

function _maintainConnection(address, port) {
  handleConnectionInterval = setTimeout(function () {
    ServerClient.send(Buffer.concat([Uint64BEZero.toBuffer(), Uint64BEZero.toBuffer(), Buffer.from(_intTo8BytesArray(255))]), port, address);
  }, 30000);
}

function _haltConnection() {
  clearInterval(handleConnectionInterval);
  handleConnectionInterval = null;
}

//**************************************************************************************************
//
// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS// HELPERS
//
//**************************************************************************************************

function _intTo16BytesArray(num) {
  var arr = new ArrayBuffer(2); // an Int16 takes 2 bytes
  var view = new DataView(arr);
  view.setUint16(0, num, false); // byteOffset = 0; litteEndian = false
  return arr;
}

function _intTo8BytesArray(num) {
  var arr = new ArrayBuffer(1); // an Int8 takes 1 bytes
  var view = new DataView(arr);
  view.setUint8(0, num, false); // byteOffset = 0; litteEndian = false
  return arr;
}

function _BytesArrayToInt(buffer, offset) {
  var value = 0;
  for (var i = offset; i <= buffer.length - 1; i++) {
    value = (value * 256) + buffer[i];
  }

  return value;
}