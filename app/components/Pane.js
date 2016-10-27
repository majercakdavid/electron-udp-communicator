import React, { Component } from 'react';

class Pane extends Component{
    constructor(){
        super();
        this.displayName = 'Pane';
    }
 
    render(){
        return(
            <div>
                {this.props.children}
            </div>
        );
    }
}

export default Pane;