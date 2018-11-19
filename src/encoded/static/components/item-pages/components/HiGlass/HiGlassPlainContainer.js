'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import { isServerSide, ajax, console, fileUtil } from './../../../util';
import { requestAnimationFrame } from './../../../viz/utilities';
import { HiGlassLocalStorage } from './HiGlassLocalStorage';


let HiGlassComponent = null; // Loaded after componentDidMount as not supported server-side.


export class HiGlassPlainContainer extends React.PureComponent {

    static does2DTrackExist(viewConfig){

        var found = false;
        
        _.forEach(viewConfig.views || [], function(view){
            if (found) return;
            _.forEach((view.tracks && view.tracks.center) || [], function(centerTrack){
                if (found) return;
                if (centerTrack.position === 'center') {
                    found = true;
                }
            });
        });

        return found;
    }

    static getPrimaryViewID(viewConfig){
        if (!viewConfig || !Array.isArray(viewConfig.views) || viewConfig.views.length === 0){
            return null;
        }
        return _.uniq(_.pluck(viewConfig.views, 'uid'))[0];
    }

    static correctTrackDimensions(hiGlassComponent){
        requestAnimationFrame(()=>{
            _.forEach(hiGlassComponent.tiledPlots, (tp) => tp && tp.measureSize());
        });
    }

    static propTypes = {
        'viewConfig' : PropTypes.object.isRequired,
        'isValidating' : PropTypes.bool,
        'height' : PropTypes.number,
        'groupID' : PropTypes.string
    };

    static defaultProps = {
        'options' : { 'bounded' : true },
        'isValidating' : false,
        'disabled' : false,
        'height' : 400,
        'viewConfig' : null,
        'groupID' : null
    };

    constructor(props){
        super(props);
        this.instanceContainerRefFunction = this.instanceContainerRefFunction.bind(this);
        this.correctTrackDimensions = this.correctTrackDimensions.bind(this);

        this.state = {
            'mounted' : false,
            'mountCount' : 0,
            'hasRuntimeError' : false
        };
    }

    componentDidMount(){
        setTimeout(()=>{ // Allow tab CSS transition to finish (the render afterwards lags browser a little bit).
            if (!HiGlassComponent) {
                window.fetch = window.fetch || ajax.fetchPolyfill; // Browser compatibility
                // Would ideally load non-compiled app, but requires CSS webpack loaders (see HiGlass webpack.config.js).
                //HiGlassComponent = require('higlass/app/scripts/hglib').HiGlassComponent;
                HiGlassComponent = require('higlass/dist/hglib').HiGlassComponent;
            }
            this.setState(function(currState){
                return { 'mounted' : true, 'mountCount' : currState.mountCount + 1 };
            }, ()=>{
                setTimeout(this.correctTrackDimensions, 500);
            });
        }, 500);
    }

    correctTrackDimensions(){
        var hgc = this.getHiGlassComponent();
        if (hgc){
            HiGlassPlainContainer.correctTrackDimensions(hgc);
        } else {
            console.error('NO HGC');
        }
    }

    componentWillUnmount(){
        this.setState({ 'mounted' : false });
    }

    componentDidCatch(){
        this.setState({ 'hasRuntimeError' : true });
    }

    /**
     * Fade in div element containing HiGlassComponent after HiGlass initiates & loads in first tile etc. (about 500ms).
     * For prettiness only.
     */
    instanceContainerRefFunction(element){
        if (element){ // Fade this in. After HiGlass initiates & loads in first tile etc. (about 500ms). For prettiness only.
            setTimeout(function(){
                requestAnimationFrame(function(){
                    element.style.transition = null; // Use transition as defined in stylesheet
                    element.style.opacity = 1;
                });
            }, 500);
        }
    }

    getHiGlassComponent(){
        return (this && this.refs && this.refs.hiGlassComponent) || null;
    }

    getCurrentViewConfig(){
        return (
            this.refs && this.refs.hiGlassComponent && this.refs.hiGlassComponent.state.viewConfig
        ) || null;
    }

    render(){
        var { disabled, isValidating, tilesetUid, height, width, options, style, className, viewConfig } = this.props,
            hiGlassInstance = null,
            mounted         = (this.state && this.state.mounted) || false,
            outerKey        = "mount-number-" + this.state.mountCount;

        if (isValidating || !mounted){
            var placeholderStyle = {};
            if (typeof height === 'number' && height >= 140){
                placeholderStyle.height = height;
                placeholderStyle.paddingTop = (height / 2) - 40;
            }
            hiGlassInstance = (
                <div className="col-sm-12 text-center" style={placeholderStyle} key={outerKey}>
                    <h3>
                        <i className="icon icon-lg icon-television"/>
                    </h3>
                    Initializing
                </div>
            );
        } else if (disabled) {
            hiGlassInstance = (
                <div className="col-sm-12 text-center" key={outerKey} style={placeholderStyle}>
                    <h4 className="text-400">Not Available</h4>
                </div>
            );
        } else if (this.state.hasRuntimeError) {
            hiGlassInstance = (
                <div className="col-sm-12 text-center" key={outerKey} style={placeholderStyle}>
                    <h4 className="text-400">Runtime Error</h4>
                </div>
            );
        } else {
            hiGlassInstance = (
                <div key={outerKey} className="higlass-instance" style={{ 'transition' : 'none', 'height' : height, 'width' : width || null }} ref={this.instanceContainerRefFunction}>
                    <HiGlassComponent {...{ options, viewConfig, width, height }} ref="hiGlassComponent" />
                </div>
            );
        }

        /**
         * TODO: Some state + UI functions to make higlass view full screen.
         * Should try to make as common as possible between one for workflow tab & this. Won't be 100% compatible since adjust workflow detail tab inner elem styles, but maybe some common func for at least width, height, etc.
         */
        return (
            <div className={"higlass-view-container" + (className ? ' ' + className : '')} style={style}>
                <link type="text/css" rel="stylesheet" href="https://unpkg.com/higlass@1.2.5/dist/hglib.css" crossOrigin="true" />
                {/*<script src="https://unpkg.com/higlass@0.10.19/dist/scripts/hglib.js"/>*/}
                <div className="higlass-wrapper row" children={hiGlassInstance} />
            </div>
        );
    }


}