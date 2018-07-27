'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import { stringify } from 'query-string';
import { console, layout, navigate, ajax } from'./../util';
import * as globals from './../globals';
import StaticPage from './StaticPage';
import * as d3 from 'd3';


export default class StatisticsPageView extends StaticPage {

    render(){
        return (
            <StaticPage.Wrapper>
                <StatisticsViewController>
                    <layout.WindowResizeUpdateTrigger>
                        <StatisticsChartsView />
                    </layout.WindowResizeUpdateTrigger>
                </StatisticsViewController>
            </StaticPage.Wrapper>
        );
    }

}



/**
 * Requests URIs defined in CHART_SEARCH_URIS, saves responses to own state, then passes down responses into child component(s).
 */
export class StatisticsViewController extends React.PureComponent {

    static CHART_SEARCH_URIS = {
        'File'                      : '/search/?type=File&experiments.display_title!=No%20value&limit=0',
        'ExperimentSetReplicate'    : function(props) {
            return '/search/?' + stringify(navigate.getBrowseBaseParams()) + '&limit=0';
        }
    };

    constructor(props){
        super(props);
        this.performSearchRequests  = this.performSearchRequests.bind(this);
        this.stateToChildProps      = this.stateToChildProps.bind(this);
        this.state = _.extend(
            { 'mounted' : false, 'loadingStatus' : 'loading' },
            _.object(_.map(_.keys(StatisticsViewController.CHART_SEARCH_URIS), function(k){ return ['resp' + k,null]; }))
        );
    }

    componentDidMount(){
        var nextState = { 'mounted' : true };
        this.performSearchRequests();
        this.setState(nextState);
    }

    performSearchRequests(chartUris = StatisticsViewController.CHART_SEARCH_URIS){ // TODO: Perhaps make search uris a prop.

        var resultStateToSet = {};

        var chartUrisAsPairs = _.pairs(chartUris),
            failureCallback = function(){
                this.setState({ 'loadingStatus' : 'failed' });
            }.bind(this),
            uponAllRequestsCompleteCallback = function(state = resultStateToSet){
                this.setState(_.extend({ 'loadingStatus' : 'complete' }, state));
            }.bind(this),
            uponSingleRequestsCompleteCallback = function(key, uri, resp){
                if ((resp && resp.code === 404) || _.keys(resp.aggregations).length === 0){
                    failureCallback();
                    return;
                }
                resultStateToSet['resp' + key] = resp;
                uponAllRequestsCompleteCallback(resultStateToSet);
            };

        if (chartUrisAsPairs.length > 1) {
            uponAllRequestsCompleteCallback = _.after(chartUrisAsPairs.length, uponAllRequestsCompleteCallback);
        }

        _.forEach(_.pairs(chartUris), ([key, uri]) => {
            if (typeof uri === 'function') uri = uri(this.props);
            ajax.load(uri, uponSingleRequestsCompleteCallback.bind(this, key, uri), 'GET', failureCallback);
        });

    }

    stateToChildProps(state = this.state){
        return _.object(_.filter(_.pairs(state), (pair)=>{
            // Which key:value pairs to pass to children.                
            if (pair[0] === 'mounted' || pair[0] === 'loadingStatus') return true;
            if (!state.mounted || state.loadingStatus !== 'complete') return false; // Don't pass responses in until finished.
            return true;
        }));
    }

    render(){
        if (Array.isArray(this.props.children)){
            return React.Children.map(this.props.children, (c)=>{
                return React.cloneElement(c, this.stateToChildProps(this.state));
            });
        } else {
            return React.cloneElement(this.props.children, this.stateToChildProps(this.state));
        }
    }

}



export class StatisticsChartsView extends React.Component {

    loadingIcon(){
        return (
            <div className="mt-5 mb-5 text-center">
                <i className="icon icon-fw icon-spin icon-circle-o-notch icon-2x" style={{ opacity : 0.5 }}/>
                <h5 className="text-400">Loading Data</h5>
            </div>
        );
    }

    errorIcon(){
        return (
            <div className="mt-5 mb-5 text-center">
                <i className="icon icon-fw icon-times icon-2x"/>
                <h5 className="text-400">Loading failed. Please try again later.</h5>
            </div>
        );
    }

    render(){
        var { loadingStatus, mounted } = this.props;
        if (!mounted || loadingStatus === 'loading')    return this.loadingIcon();
        if (loadingStatus === 'failed')                 return this.errorIcon();
        return (
            <div className="stats-charts-container row">
                <div className="col-xs-12 col-lg-6">
                    <AreaChart data={aggregationsToChartData[0].function(this.props.respExperimentSetReplicate)} />
                </div>
            </div>
        );
    }

}

export const aggregationsToChartData = [
    {
        'requires'  : 'ExperimentSetReplicate',
        'title'     : '4DN Experiment Sets Public Releases',
        'function'  : function(resp){
            if (!resp.aggregations) return null;
            var weeklyIntervalBuckets = resp.aggregations.weekly_interval_public_release && resp.aggregations.weekly_interval_public_release.buckets;
            if (!Array.isArray(weeklyIntervalBuckets) || weeklyIntervalBuckets.length < 2) return null;

            var total = 0;
            var subTotals = {};
            var aggsList = _.map(weeklyIntervalBuckets, function(bucket, index){
                total += bucket.doc_count;
                return {
                    'date'     : bucket.key_as_string.split('T')[0], // Sometimes we get a time back with date when 0 doc_count; correct it to date only.
                    'count'    : bucket.doc_count,
                    'total'    : total,
                    'byAward' : _.map((bucket.group_by_award && bucket.group_by_award.buckets) || [], function(subBucket){
                        subTotals[subBucket.key] = (subTotals[subBucket.key] || 0) + subBucket.doc_count;
                        return {
                            'term'  : subBucket.key,
                            'count' : subBucket.doc_count,
                            'total' : subTotals[subBucket.key]
                        };
                    })
                };
            });

            return aggsList;
        }
    }
];


export class AreaChart extends React.PureComponent {

    static defaultProps = {
        'margin'        : { 'top': 20, 'right': 20, 'bottom': 30, 'left': 50 },
        'data'          : null,
        'd3TimeFormat'  : '%Y-%m-%d'
    };

    constructor(props){
        super(props);
        this.drawNewChart = this.drawNewChart.bind(this);
        this.parseTime = d3.timeParse(props.d3TimeFormat);
        this.drawnD3Elements = {};
        this.state = {
            'drawingError' : false,
            'drawn' : false
        };
    }

    componentDidMount(){
        this.drawNewChart();
    }

    componentWillReceiveProps(nextProps){
        if (nextProps.d3TimeFormat !== this.props.d3TimeFormat){
            this.parseTime = d3.timeParse(nextProps.d3TimeFormat);
        }
    }

    componentDidUpdate(pastProps, pastState){
        // TODO: this.updateExistingChart();
    }

    /**
     * Draws D3 area chart using the DOM a la https://bl.ocks.org/mbostock/3883195 in the rendered <svg> element.
     *
     * TODO: We should try to instead render out <path>, <g>, etc. SVG elements directly out of React to be more Reactful and performant.
     * But this can probably wait (?).
     */
    drawNewChart(){
        if (!this.refs || !this.refs.svg){
            this.setState({ 'drawingError' : true });
            return;
        }
        var { margin, data } = this.props;
        var svg         = d3.select(this.refs.svg),
            width       = (this.props.width  || parseInt(svg.style('width' ))) - margin.left - margin.right,
            height      = (this.props.height || parseInt(svg.style('height'))) - margin.top - margin.bottom,
            drawn       = { svg };

        var x       = d3.scaleTime().rangeRound([0, width]),
            y       = d3.scaleLinear().rangeRound([height, 0]);

        // Convert timestamps to D3 date objects.
        data = _.map(data, (d) => {
            var formattedDate = (new Date(d.date.slice(0,10))).toISOString().slice(0,10);
            return _.extend({}, d, {
                'date' : this.parseTime(formattedDate),
                'origDate' : formattedDate
            });
        });

        x.domain(d3.extent(data, function(d){ return d.date; }));
        y.domain([ 0, d3.max(data, function(d) { return d.total; }) ]);

        var area = d3.area()
            .x(function(d){ return x(d.date); })
            .y1(function(d){ return y(d.total); })
            .y0(y(0));

        var bottomAxisGenerator = d3.axisBottom(x).ticks(d3.timeMonth.every(1)); // One tick a month

        drawn.g = svg.append("g").attr('transform', "translate(" + margin.left + "," + margin.top + ")");
        drawn.path = drawn.g.append('path')
            .datum(data)
            .attr('fill', 'steelblue')
            .attr('d', area);

        drawn.xAxis = drawn.g.append('g')
            .attr("transform", "translate(0," + height + ")")
            .call(bottomAxisGenerator);

        drawn.yAxis = drawn.g.append('g')
            .call(d3.axisLeft(y))
            .append('text')
            .attr("fill", "#000")
            .attr("transform", "rotate(-90)")
            .attr("y", 6)
            .attr("dy", "0.71em")
            .attr("text-anchor", "end")
            .text("Count");

        this.drawnD3Elements = drawn;
    }

    updateExistingChart(){

        // TODO:
        // If width or height has changed, transition existing DOM elements to larger dimensions
        // If data has changed.... decide whether to re-draw graph or try to transition it.

    }

    render(){
        if (!this.props.data || this.state.drawingError) {
            return <div>Error</div>;
        }
        return <svg ref="svg" className="area-chart" width={this.props.width || "100%"} height={this.props.height || null} />;
    }

}


globals.content_views.register(StatisticsPageView, 'StatisticsPage');
