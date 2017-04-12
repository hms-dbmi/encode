'use strict';

var React = require('react');
var _ = require('underscore');
var ReactTooltip = require('react-tooltip');

var AuditView = module.exports = React.createClass({

    statics : {

        /**
         * @static
         * @public
         * @param {Object} context - Item object representation containing 'audit' property.
         * @returns {string} Classname suffix for FontAwesome icon to use as indicator icon.
         */
        getItemIndicatorIcon : function(context){
            var auditIconClass = 'warning';
            if (context.audit && context.audit.ERROR && context.audit.ERROR.length){
                auditIconClass = 'exclamation-circle';
            } else if (context.audit && context.audit.WARNING && context.audit.WARNING.length){

            } else if (!AuditView.doAnyAuditsExist(context)){
                auditIconClass = 'check';
            }
            return auditIconClass;
        },

        /**
         * @static
         * @public
         * @param {Object} context - Item object representation containing 'audit' property.
         * @returns {boolean} True if any audits exist.
         */
        doAnyAuditsExist : function(context){
            if (typeof context.audit === 'undefined') return false;
            if (_.keys(context.audit).length === 0 || _.reduce(context.audit, function(m,v){ return m + v.length; }, 0) === 0){
                return false;
            } else {
                return true;
            }
        },

        /**
         * Returns string broken into parts with a JSON segment in it.
         * 
         * @param {string} String with potential JSON string.
         * @returns {string[]} Array with either 1 part (no valid JSON found) or 3 parts (beforestring, JSONstring, afterstring).
         */
        findJSONinString : function(str = "Some string { 'test' : 123 }"){
            //var r = str.search(/\{([^{}]|(?R))*\}/g);
            var i;
            var strLen = str.length;
            var firstBracketIndex = null;
            var lastBracketIndex = null;
            var openBrackets = 0;
            var closeBrackets = 0;
            for (i = 0; i < strLen; i++){
                if (str.charAt(i) === '{'){
                    openBrackets++;
                    if (firstBracketIndex === null) firstBracketIndex = i;
                    continue;
                }
                if (firstBracketIndex !== null){
                    if (str.charAt(i) === '}'){
                        closeBrackets++;
                        if (closeBrackets === openBrackets){
                            lastBracketIndex = i;
                            break;
                        }
                    }
                }
            }
            var result;
            if (firstBracketIndex !== null && lastBracketIndex !== null){
                result = [
                    str.slice(0, firstBracketIndex).trim(),
                    str.slice(firstBracketIndex, lastBracketIndex + 1),
                    str.slice(lastBracketIndex + 1, strLen).trim()
                ].map(function(r){
                    if (r.length === 0) return null;
                    return r;
                });
            } else {
                result = [
                    str.trim()
                ];
            }
            return result;
        },

        convertJSONToTable : function(jsonString){
            var jsonObj;
            if (typeof jsonString === 'string' && jsonString.charAt(0) === '{' && jsonString.charAt(jsonString.length - 1) === '}'){
                try {
                    try {
                        jsonObj = JSON.parse(jsonString);
                    } catch (e){
                        jsonString = jsonString.replace(/'/g, '"');
                        jsonObj = JSON.parse(jsonString);
                    }
                } catch (e){
                    return <code>{ jsonString }</code>;
                }
            } else if (typeof jsonString === 'object' && jsonString){
                jsonObj = jsonString;
            } else {
                console.error("Invalid JSON supplied. Returning original: " + jsonString);
                return <code>{ jsonString }</code>;
            }
            return (
                <ul>
                { _.pairs(jsonObj).map(function(r, i){
                    return (
                        <li key={i}>
                            <span className="pull-right">({ r[1] })</span>
                            <code>{ r[0] }</code>
                        </li>
                    );
                }) }
                </ul>
            );
        },

        AuditItem : React.createClass({

            propTypes : {
                level : React.PropTypes.oneOf(['ERROR', 'WARNING', 'INTERNAL_ACTION'])
            },

            render : function(){
                var audit = this.props.audit;
                var details = audit.detail.split('\n').filter(function(a){ return a !== '' && a; }); // Split newlines into sep. paragraphs.
                return (
                    <div className="row audit-item">
                        <div className="col-xs-12 col-sm-12 audit-category">
                            <span>
                                <h4 className="text-500">{ audit.category }</h4>
                            </span>
                        </div>
                        <div className="col-xs-12 col-sm-12 audit-detail">
                            <ul>{
                                details.map(function(d,i){
                                    var detailParts = AuditView.findJSONinString(d);
                                    return (
                                        <li key={i}>
                                            { detailParts[0] ? 
                                                <div>{ detailParts[0] }</div>
                                            : null }
                                            { detailParts[1] ? 
                                                <div>{ AuditView.convertJSONToTable(detailParts[1]) }</div>
                                            : null }
                                            { detailParts[2] ? 
                                                <div>{ detailParts[2] }</div>
                                            : null }
                                        </li>
                                    );
                                })
                            }</ul>
                        </div>
                    </div>
                );
            }

        }),

        AuditCategory : React.createClass({

            propTypes : {
                'level' : React.PropTypes.oneOf(['ERROR', 'WARNING', 'INTERNAL_ACTION']),
                'title' : React.PropTypes.string
            },

            iconClass : function(){
                if (this.props.level === 'WARNING') return 'warning';
                if (this.props.level === 'ERROR') return 'exclamation-circle';
                if (this.props.level === 'INTERNAL_ACTION') return 'tachometer';
                return 'warning';
            },

            render : function(){
                var audits = this.props.audits;
                var level = this.props.level;
                if (!Array.isArray(audits[level]) || audits[level].length === 0) return null;
                return (
                    <div className={"audits-view-" + level}>
                        
                        <hr className="tab-section-title-horiz-divider"/>
                        <div className="row">

                            <div className="col-sm-2">
                                <h3 className="text-left">
                                    {/*<span className="text-400">{ audits[level].length }</span> */}<i
                                        data-tip={audits[level].length + ' ' + this.props.title + (audits[level].length > 1 ? 's' : '')}
                                        data-place="right"
                                        className={"icon icon-fw icon-" + this.iconClass()}
                                    />
                                </h3>
                                {/*<h3 className="text-300">{ this.props.title }{audits[level].length > 1 ? 's' : ''}</h3>*/}
                            </div>

                            <div className="audits-container col-xs-12 col-sm-10">
                            {
                                audits[level].map(function(aud, i){
                                    return <AuditView.AuditItem audit={aud} key={i} level={aud.level_name || level || "ERROR"} />;
                                })
                            }
                            </div>
                            
                        </div>
                    </div>
                );
            }

        })

    },

    componentDidMount : function(){
        ReactTooltip.rebuild();
    },

    render : function(){
        return (
            <div className="audits-view">
                <h3 className="tab-section-title">Audits</h3>
                <AuditView.AuditCategory level="ERROR" audits={this.props.audits} title="Error" />
                <AuditView.AuditCategory level="WARNING" audits={this.props.audits} title="Warning" />
                <AuditView.AuditCategory level="INTERNAL_ACTION" audits={this.props.audits} title="Internal Action" />
            </div>
        );
    }

});