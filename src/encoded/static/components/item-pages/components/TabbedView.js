'use strict';

var React = require('react');
var _ = require('underscore');

var Tabs = require('rc-tabs/lib/Tabs');
var TabContent = require('rc-tabs/lib/TabContent');
var ScrollableInkTabBar = require('rc-tabs/lib/ScrollableInkTabBar');

var TabView = module.exports = React.createClass({

    getDefaultProps : function(){
        return {
            'contents' : [
                { tab : "Tab 1", content : <span>Test1</span> },
                { tab : "Tab 2", content : <span>Test2</span> }
            ],
            'animated' : false
        };
    },

    render : function(){
        var tabsProps = {
            renderTabBar     : ()=><ScrollableInkTabBar onTabClick={this.props.onTabClick} extraContent={this.props.extraTabContent} />,
            renderTabContent : ()=><TabContent animated={this.props.animated} />,
            onChange         : this.props.onChange,
            destroyInactiveTabPane : this.props.destroyInactiveTabPane
        };
        if (this.props.activeKey) tabsProps.activeKey = this.props.activeKey;
        return (
            <Tabs {...tabsProps} >
                {
                    this.props.contents.map(function(t){
                        return (
                            <Tabs.TabPane
                                key={t.key || t.tab || t.title}
                                tab={<span className="tab">{ t.tab || t.title }</span>}
                                children={t.content}
                                placeholder={t.placeholder}
                                disabled={t.disabled}
                            />
                        );
                    })
                }
            </Tabs>
        );
    }

});