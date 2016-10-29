import React, { Component } from 'react';
import Tabs from './Tabs';
import Pane from './Pane';
import { app, ipcRenderer } from 'electron';

var _this;

class App extends Component {
    constructor() {
        super();
        _this = this;

        this.state = {
            available_addresses: null,

            config_ip: "",
            config_port: "",
            config_message: "",

            destination_ip: "",
            destination_port: "",
            destination_fragment_size: "",
            destination_message: "",
            destination_data: null,

            received_messages: [],

            displayed_message_details: null,
            displayed_message_text: null
        }
        ipcRenderer.on('message_received', this._onMessageReceived);
    }

    componentWillMount() {
        var addresses = ipcRenderer.sendSync('get-available-addresses');
        if (addresses) {
            this.setState({ available_addresses: addresses });
            // Defaultly selected
            this.setState({config_ip: addresses[0]});
        }

        var response = ipcRenderer.sendSync('get-server-conf');
        if (response) {
            if (response.type == "ERROR") {
                this.setState({ config_message: response.type + ": " + response.message });
            } else {
                this.setState({
                    config_message: "Server started, address: " + response.address + " ,port: " + response.port + ".",
                    config_ip: response.address,
                    config_port: response.port
                });
            }
        }
    }

    _handleFormChange(e) {
        this.setState({ [e.target.name]: e.target.value });
    }

    _handleStartServerClient(e) {
        e.preventDefault();

        var ipRegEx = new RegExp(/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/);
        if (this.state.config_port < 49152 || this.state.config_port > 65535) {
            alert("ERROR: Port out of range(49152-65535)!");
            return;
        }
        if (!ipRegEx.test(this.state.config_ip)) {
            alert("ERROR: IP address is not in correct format!");
            return;
        }

        var response = ipcRenderer.sendSync('start-server-client-udp', {
            address: this.state.config_ip,
            port: this.state.config_port
        });
        if (response.type && response.type == "ERROR") {
            this.setState({
                config_ip: "",
                config_port: "",
                config_message: response.type + ": " + response.message
            });
        } else {
            this.setState({
                config_ip: response.address,
                config_port: response.port,
                config_message: "Server started, address: " + response.address + " ,port: " + response.port + "."
            });
        }
    }

    _handleStopServerClient(e) {
        e.preventDefault();
        var response = ipcRenderer.sendSync('stop-server-client-udp');
        if (JSON.stringify(response).startsWith("ERROR")) {
            this.setState({
                config_message: response
            });
        } else {
            this.setState({
                config_ip: "",
                config_port: "",
                config_message: ""
            });
        }
    }

    _handleSendMessage(err, e) {
        e.preventDefault();

        var ipRegEx = new RegExp(/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/);
        if (this.state.destination_port < 49152 || this.state.destination_port > 65535) {
            alert("ERROR: Port out of range(49152-65535)!");
            return;
        }
        if (!ipRegEx.test(this.state.destination_ip)) {
            alert("ERROR: IP address is not in correct format!");
            return;
        }

        var response;
        if (err) {
            response = ipcRenderer.sendSync('send-data', {
                address: this.state.destination_ip,
                port: this.state.destination_port,
                fragmentSize: this.state.destination_fragment_size,
                message: this.state.destination_message,
                data: this.state.destination_data,
                error: true
            });
        } else {
            response = ipcRenderer.sendSync('send-data', {
                address: this.state.destination_ip,
                port: this.state.destination_port,
                fragmentSize: this.state.destination_fragment_size,
                message: this.state.destination_message,
                data: this.state.destination_data,
                error: false
            });
        }

        this.setState({
            destination_message: "",
            destination_data: null,
        });
        document.getElementById('destination_files').value = '';
        if (response.type === "SUCCESS") {
            console.log(response.type + ": " + response.message);
            alert(response.type + ": " + response.message);
        } else {
            console.log(response.type + ": " + response.message);
            alert(response.type + ": " + response.message);
        }
    }

    _handleSendErrorMessage(e) {
        e.preventDefault();
    }

    readFile(e) {
        var file = e.target.files[0];
        var fileInfo;
        if (!file) {
            fileInfo = null;
        } else {
            fileInfo = {
                name: file.name,
                path: file.path,
                size: file.size
            }
        }
        // get the file
        this.setState({ destination_data: fileInfo });
    }

    _onMessageReceived(event, args) {
        let new_received_messages = [..._this.state.received_messages, { id: args.id, message: args.message, data: args.data, address: args.address, port: args.port }];

        _this.setState({
            received_messages: new_received_messages
        });
    }

    _saveAttachedFile(messageID) {
        var response = ipcRenderer.sendSync('save-file', messageID);
        alert(response.type + ": " + response.message);
    }

    _showMessageDetails(messageID) {
        var response = ipcRenderer.sendSync('get-message-details', messageID);
        this.setState({ displayed_message_details: response, displayed_message_text: this.state.received_messages[messageID].message });
    }

    render() {
        // Disable other tabs, but config, until config is done
        var configDone = true;
        if (this.state.config_ip != null && this.state.config_ip != "" && this.state.config_port != null && this.state.config_port != "") {
            configDone = false;
        }

        var availableAddresses = null;
        if (this.state.available_addresses) {
            availableAddresses = this.state.available_addresses.map((address, i) => {
                return (<option key={i} value={address}>{address}</option>);
            });
        }

        // Message about the address and port of the running server
        var infoMessage = null;
        var button = <input type="button" name="start_server_client_button" className="btn btn-form btn-positive" value="Start Server" onClick={this._handleStartServerClient.bind(this)} />;
        if (this.state.config_message != null && this.state.config_message != "") {
            if (this.state.config_message.startsWith("ERROR")) {
                infoMessage = <div id="server_client_message" className="btn-negative">{this.state.config_message}</div>;
            }
            else {
                infoMessage = <div id="server_client_message" className="btn-positive">{this.state.config_message}</div>;
                button = <input type="button" name="stop_server_client_button" className="btn btn-form btn-negative" value="Stop Server" onClick={this._handleStopServerClient.bind(this)} />;
            }
        }
        else {
            infoMessage = null;
        }

        // Show list with received messages
        var receivedMessages = null;
        if (this.state.received_messages.length > 0) {
            receivedMessages = this.state.received_messages.map((message, i) => {
                var dataInfo, messageContent;
                if (message.data != null && message.data != {}) {
                    dataInfo = <div>
                        <p>Filename: {message.data.name}</p><p>Size: {message.data.size}</p>
                        <button className="btn btn-mini btn-default" onClick={this._saveAttachedFile.bind(this, message.id)}>Save file</button>
                    </div>;
                } else {
                    dataInfo = <p>No attached file.</p>;
                }
                if (message.message != null && message.message != "") {
                    messageContent = <p>Message: {message.message}</p>
                } else {
                    messageContent = <p>No message received</p>
                }
                return (
                    <li className="list-group-item" key={message.id}>
                        <div className="media-body">
                            <strong>{message.address + ":" + message.port}</strong>
                            <p>Message: {message.message}</p>
                            {dataInfo}
                            <button className="btn btn-mini btn-default" onClick={this._showMessageDetails.bind(this, message.id)}>Show details</button>
                        </div>
                    </li>
                )
            });
        }
        else {
            receivedMessages = <strong>No Messages to display...</strong>
        }

        var messageText = null;
        if(this.state.displayed_message_text){
            messageText =   <div className="form-group">
                                <label>Received message</label>
                                <textarea className="form-control" rows="3" readonly>{ this.state.displayed_message_text }</textarea>
                            </div>;
        }
        // Prepare list with the details about message
        var messageDetails = null;
        if (this.state.displayed_message_details) {
            messageDetails = this.state.displayed_message_details.map((detail, i) => {
                let correctCRC32 = detail.crc32 ? "Correct" : "Incorrect";
                let multipleReceived = detail.receivedMultiple ? "Yes" : "No";
                let color = "btn-default";
                if (!detail.crc32 || detail.receivedMultiple) {
                    color = "btn-negative";
                }
                return (
                    <tr className={color} key={i}>
                        <td>{detail.id}</td>
                        <td>{correctCRC32}</td>
                        <td>{multipleReceived}</td>
                    </tr>
                );
            });
        } else {
            messageDetails = null;
        }

        return (
            <div className="window">
                <div className="window-content">
                    <Tabs selected={0}>
                        <Pane label="Configuration" icon="icon icon-cog">
                            <form id="config_form">
                                {infoMessage}
                                <div className="form-group">
                                    <label>Server IP Address</label>
                                    <select name="config_ip" className="form-control" value={this.state.config_ip} onChange={this._handleFormChange.bind(this)}>
                                        {availableAddresses}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Server Port</label>
                                    <input name="config_port" type="number" min="49152" max="65535" className="form-control" placeholder="Server Port" value={this.state.config_port} onChange={this._handleFormChange.bind(this)} />
                                </div>
                                <div className="form-actions">
                                    {button}
                                </div>
                            </form>
                        </Pane>
                        <Pane label="Send message" icon="icon icon-cog" disabled={configDone}>
                            <form id="send_message_form">
                                <div className="form-group">
                                    <label>Destination IP Address</label>
                                    <input name="destination_ip" type="text" required pattern="((^|\.)((25[0-5])|(2[0-4]\d)|(1\d\d)|([1-9]?\d))){4}$" className="form-control" placeholder="Destination IP" value={this.state.destination_ip} onChange={this._handleFormChange.bind(this)} required />
                                </div>
                                <div className="form-group">
                                    <label>Destination Port</label>
                                    <input name="destination_port" type="number" min="49152" max="65535" className="form-control" placeholder="Destination Port" value={this.state.destination_port} onChange={this._handleFormChange.bind(this)} required />
                                </div>
                                <div className="form-group">
                                    <label>Maximum size of fragment</label>
                                    <input name="destination_fragment_size" type="number" min="1" max="65535" className="form-control" placeholder="Maximum size of fragment" value={this.state.destination_fragment_size} onChange={this._handleFormChange.bind(this)} />
                                </div>
                                <div className="form-group">
                                    <label>Text to send</label>
                                    <textarea name="destination_message" className="form-control" rows="3" placeholder="Type in message, you want to send..." value={this.state.destination_message} onChange={this._handleFormChange.bind(this)}></textarea>
                                </div>
                                <div className="form-group">
                                    <label>Files to send</label>
                                    <input type="file" className="form-control" id="destination_files" rows="3" multiple={false} onChange={this.readFile.bind(this)} />
                                </div>
                                <div className="form-actions">
                                    <input name="send_error_data_button" type="submit" className="btn btn-form btn-negative" onClick={this._handleSendMessage.bind(this, true)} value="Send error frame" />
                                    <input name="send_data_button" type="submit" className="btn btn-form btn-positive" onClick={this._handleSendMessage.bind(this, false)} value="Send message" />
                                </div>
                            </form>
                        </Pane>
                        <Pane label="Received Messages" icon="icon icon-cog" disabled={configDone}>
                            <div className="pane-group">
                                <div className="pane-sm sidebar">
                                    <ul className="list-group">
                                        <li className="list-group-header">
                                            <strong className="form-control">Received messages</strong>
                                        </li>
                                        {receivedMessages}
                                    </ul>
                                </div>
                                <div className="pane padded-more">
                                    { messageText }
                                    <table className="table-striped">
                                        <thead>
                                            <tr>
                                                <th>ID</th>
                                                <th>CRC32</th>
                                                <th>Received Multiple</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {messageDetails}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </Pane>
                    </Tabs>
                </div>
            </div>
        );
    }
}

export default App;