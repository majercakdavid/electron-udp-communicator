import React, { Component } from 'react';

class Tabs extends Component{
    constructor(){
        super();
        this.displayName = 'Tabs';
        this.props={
            selected: 0
        }
        this.state={
            selected: this.props.selected
        }
    }

    _renderTitles(){
        function labels(child, index){
            let isEnabled = this.handleClick.bind(this, index);
            if(child.props.disabled)
                isEnabled = null;
            let activeClass = (this.state.selected === index ? 'nav-group-item active' : 'nav-group-item');
            return(
                <span key={index} className={activeClass} onClick={isEnabled}>
                    <span className={child.props.icon}></span>
                    <span>{child.props.label}</span>
                </span>
            );
        }
        return(
            <div className="pane-sm sidebar padded-more">
                <nav className="nav-group">
                    <h5 className="nav-group-title">Side menu</h5>
                    {this.props.children.map(labels.bind(this))}
                </nav>
            </div>
        );
    }

    _renderContent(){
        return(
            <div className="pane padded-more">
                {this.props.children[this.state.selected]}
            </div>
        );
    }

    handleClick(index, event){
        event.preventDefault();
        this.setState({
            selected: index
        });
    }

    render(){
        return(
            <div className="pane-group">
                {this._renderTitles()}
                {this._renderContent()}
            </div>
        );
    }
}

export default Tabs;