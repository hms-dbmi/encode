'use strict';

var React = require('react');
var _ = require('underscore');
var { console } = require('./../../util');
var store = require('../../../store');
var globals = require('./../../globals');
var announcements_data = require('../../../data/announcements_data');
var Collapse = require('react-bootstrap').Collapse;


var Announcement = React.createClass({
    getInitialState: function() {
        return {
            active: true
        };
    },

    handleToggle: function(e) {
        e.preventDefault();
        this.setState({active: !this.state.active});
    },

    render: function() {
        var title = this.props.content.title || "";
        var author = this.props.content.author || "";
        var date = this.props.content.date || "";
        var content = this.props.content.content || "";
        var active = this.state.active;
        var subtitle;
        if (author && date){
            subtitle = "Posted by " + author + " | " + date;
        }else if (author && !date){
            subtitle = "Posted by " + author;
        }else if (!author && date){
            subtitle = "Posted on " + date;
        }else{
            subtitle = "";
        }

        var icon = null;
        if (this.props.icon){
            if (this.props.icon === true){
                icon = <i className={"icon text-small icon-" + (this.state.active ? 'minus' : 'plus')}></i>;
            } else {
                icon = this.props.icon; // Custom icon maybe for future
            }
        }

        return (
            <div className="fourDN-section announcement">
                <div className="fourDN-section-title announcement-title">
                    <a className="fourDN-section-toggle" href="#" onClick={this.handleToggle}>
                        {icon} {title}
                    </a>
                </div>
                <div className="fourDN-section-info announcement-subtitle">{subtitle}</div>
                <Collapse in={this.state.active}>
                    <div className="fourDN-content announcement-content">
                        <p dangerouslySetInnerHTML={{__html: content}}></p>
                    </div>
                </Collapse>
            </div>
        );
    }
});



var Announcements = module.exports = React.createClass({
    render : function(){
        var announcements = announcements_data.map(function(announce) {
            return (
                <Announcement key={announce.title} content={announce} icon={announcements_data.length > 3 ? true : false} />
            );
        });
        return (
            <div>
                <h3 className="fourDN-header">Announcements</h3>
                {announcements}
            </div>
        );
    }
});