'use strict';

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import ReactTooltip from 'react-tooltip';
import memoize from 'memoize-one';
import Dropdown from 'react-bootstrap/esm/Dropdown';
import DropdownButton from 'react-bootstrap/esm/DropdownButton';
import DropdownItem from 'react-bootstrap/esm/DropdownItem';
import Modal from 'react-bootstrap/esm/Modal';
import Fade from 'react-bootstrap/esm/Fade';

import { JWT, console, object, ajax, layout, navigate } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { Alerts } from '@hms-dbmi-bgm/shared-portal-components/es/components/ui/Alerts';
import { LinkToSelector } from '@hms-dbmi-bgm/shared-portal-components/es/components/forms/components/LinkToSelector';
import { Detail } from '@hms-dbmi-bgm/shared-portal-components/es/components/ui/ItemDetailList';

import { HiGlassPlainContainer } from './components/HiGlass/HiGlassPlainContainer';
import { CollapsibleItemViewButtonToolbar } from './components/CollapsibleItemViewButtonToolbar';
import { Wrapper as ItemHeaderWrapper, TopRow, MiddleRow, BottomRow } from './components/ItemHeader';
import { EmbeddedItemSearchTable } from './components/tables/ItemPageTable';
import DefaultItemView from './DefaultItemView';
import { EditableField, FieldSet } from '@hms-dbmi-bgm/shared-portal-components/es/components/forms/components/EditableField';

export default class HiGlassViewConfigView extends DefaultItemView {

    itemHeader() {
        const itemActionsDescriptions = {
            'edit': 'Edit the properties of this Item.',
        };

        return (
            <ItemHeaderWrapper {..._.pick(this.props, 'context', 'href', 'schemas', 'windowWidth')}>
                <TopRow itemActionsDescriptions={itemActionsDescriptions} typeInfoVisible={false} />
                <MiddleRow isInlineEditable />
                <BottomRow />
            </ItemHeaderWrapper>
        );
    }

    getTabViewContents(){
        const initTabs = [];
        const width = this.getTabViewWidth();
        initTabs.push(HiGlassViewConfigTabView.getTabObject(this.props, width));
        return initTabs.concat(this.getCommonTabs());
    }

}

export class HiGlassViewConfigTabView extends React.PureComponent {

    static getTabObject(props, width){
        return {
            'tab' : <span><i className="icon icon-fw icon-tv fas"/> HiGlass Browser</span>,
            'key' : 'higlass',
            'disabled' : false,
            'content' : <HiGlassViewConfigTabView {...props} width={width} />
        };
    }

    /**
     * get view's friendly names, i.e. left, right, top-left, bottom-middle ...
     * if there are more than 3 rows or columns, name the view with its row x col index.
     */
    static getGroupedLayouts = memoize(function (layouts) {
        let groupedLayouts = null;
        if (layouts.length > 1) {
            groupedLayouts = _.groupBy(layouts, (it) => it.y);
            const groupedLayoutKeys = _.keys(groupedLayouts);
            const rowNames = groupedLayoutKeys.length === 3 ? ['top', 'middle', 'bottom'] : (groupedLayoutKeys.length === 2 ? ['top', 'bottom'] : null);
            for (let i = 0; i < groupedLayoutKeys.length; i++) {
                const rowItem = groupedLayouts[groupedLayoutKeys[i]];
                const colNames = rowItem.length === 3 ? ['left', 'center', 'right'] : (rowItem.length === 2 ? ['left', 'right'] : null);
                for (let j = 0; j < rowItem.length; j++) {
                    rowItem[j].displayText = [
                        groupedLayoutKeys.length > 3 ? (i + 1) : ((rowNames && rowNames[i]) || null),
                        rowItem.length > 3 ? (j + 1) : ((colNames && colNames[j]) || null)
                    ].filter(Boolean).join(' - ');
                }
            }
        } else {
            const data = {};
            groupedLayouts = data[layouts[0].y.toString()] = [layouts];
        }
        return groupedLayouts;
    }, function (A, B) {
        const [arrA] = A;
        const [arrB] = B;
        if (arrA.length !== arrB.length) { return false; }
        for (let i = 0; i < arrA.length; i++) {
            if ((arrA[i].x !== arrB[i].x) || (arrA[i].y !== arrB[i].y)) { return false; }
        }
        return true;
    });

    /**
     * get tilesets and positions, width/height and view's position
     * @param {Object} viewConf: even if viewConf.views modified in function, it has no side-effect
     * since calling function always provides a fresh new argument
     */
    static getTilesetUids(viewConf) {
        const tilesetUids = {};
        if (viewConf && viewConf.views && Array.isArray(viewConf.views) && viewConf.views.length > 0) {
            _.each(viewConf.views, function (view, idx) { view.vIndex = idx; });
            viewConf.views = _.chain(viewConf.views).sortBy((view) => view.layout.x).sortBy((view) => view.layout.y).value();
            //very simple implementation of naming views - assumes views' top edge in a row is aligned
            const layouts = _.map(viewConf.views, (view) => { return { x: view.layout.x, y: view.layout.y, displayText: 'Main' }; });
            const groupedLayouts = HiGlassViewConfigTabView.getGroupedLayouts(layouts);
            //loop tracks
            const trackNames = ['top', 'right', 'bottom', 'left', 'center', 'whole', 'gallery'];
            _.each(viewConf.views, function (view) {
                const layout = _.find(groupedLayouts[view.layout.y], (it) => it.x == view.layout.x);
                if (view.tracks && typeof view.tracks === 'object') {
                    _.each(trackNames, function (trackName) {
                        const track = view.tracks[trackName];
                        if (track && Array.isArray(track) && track.length > 0) {
                            _.each(track, function (trackItem) {
                                //top, left, right, bottom and gallery?? & whole??
                                if (trackItem.tilesetUid) {
                                    if (!tilesetUids[trackItem.tilesetUid]) {
                                        tilesetUids[trackItem.tilesetUid] = [];
                                    }
                                    tilesetUids[trackItem.tilesetUid].push({ view: layout.displayText, vIndex: view.vIndex, track: trackName, width: trackItem.width, height: trackItem.height, title: trackItem.options && trackItem.options.name, uid: trackItem.uid, tilesetUid: trackItem.tilesetUid });
                                }
                                //center
                                else if (trackItem.contents && Array.isArray(trackItem.contents) && trackItem.contents.length > 0) {
                                    _.each(trackItem.contents, function (subTrackItem) {
                                        if (!tilesetUids[subTrackItem.tilesetUid]) {
                                            tilesetUids[subTrackItem.tilesetUid] = [];
                                        }
                                        tilesetUids[subTrackItem.tilesetUid].push({ view: layout.displayText, vIndex: view.vIndex, track: trackName, width: subTrackItem.width, height: subTrackItem.height, title: subTrackItem.options && subTrackItem.options.name, uid: trackItem.uid, tilesetUid: subTrackItem.tilesetUid });
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }

        return tilesetUids;
    }

    static defaultProps = {
        'isValidating' : false,
        'disabled' : false,
        'height' : 600
    };

    constructor(props){
        super(props);
        this.fullscreenButton = this.fullscreenButton.bind(this);
        this.saveButton = this.saveButton.bind(this);
        this.cloneButton = this.cloneButton.bind(this);
        this.getHiGlassComponent = this.getHiGlassComponent.bind(this);
        this.havePermissionToEdit = this.havePermissionToEdit.bind(this);
        this.handleSave = _.throttle(this.handleSave.bind(this), 3000);
        this.handleUpdateAllTilesets = _.throttle(this.handleUpdateAllTilesets.bind(this), 3000);
        this.handleUpdateSingleTileset = _.throttle(this.handleUpdateSingleTileset.bind(this), 3000);
        this.handleModalCancel = _.throttle(this.handleModalCancel.bind(this), 3000);
        this.handleClone = _.throttle(this.handleClone.bind(this), 3000, { 'trailing' : false });
        this.handleStatusChangeToRelease = this.handleStatusChange.bind(this, 'released');
        this.handleStatusChange = this.handleStatusChange.bind(this);
        this.handleFullscreenToggle = this.handleFullscreenToggle.bind(this);
        this.hasSimilarTilesets = this.hasSimilarTilesets.bind(this);
        this.addFileToHiglass = this.addFileToHiglass.bind(this);
        this.collapseButtonTitle = this.collapseButtonTitle.bind(this);
        this.onViewConfigUpdated = _.debounce(this.onViewConfigUpdated.bind(this), 750);
        this.renderFilesDetailPane = this.renderFilesDetailPane.bind(this);
        this.updateHiglassViewConf = this.updateHiglassViewConf.bind(this);
        this.updateHiGlassComponentHeight = this.updateHiGlassComponentHeight.bind(this);

        /**
         * @property {Object} viewConfig            The viewconf that is fed to HiGlassPlainContainer. (N.B.) HiGlassComponent may edit it in place during UI interactions.
         * @property {string} genome_assembly       Common genome assembly for all files/tracks of this viewconf.
         * @property {Object} originalViewConfig    Not currently used, but might eventually be used to compare against state.viewConfig to inform whether to enable save btn or not.
         * @property {boolean} saveLoading          True if AJAX request is en route to save Item.
         * @property {boolean} cloneLoading         True if AJAX request is en route to clone Item.
         * @property {boolean} releaseLoading       True if AJAX request is en route to change Item status.
         * @property {boolean} addFileLoading       True if AJAX request is en route to add file to `state.viewConfig`.
         * @property {Object} modal                 Modal popup to confirm save/update ..etc HiGlass view conf updates
         * @property {string} filesTableSearchHref  File search url for files table
         * @property {Object} updatedTilesetField   Object having tileset field that was edited by EditableField
         * @property {Object} trackInfo             ViewConfig track object
         * @property {Object} tilesetUids           Object that all keys are tilesetUids
         * @property {number} hgcHeight        HiGlass container height
         * @property {boolean} viewConfigModified   ViewConfig is modified by one of Files table editable fields
         */
        this.state = {
            'viewConfig'            : props.context && props.context.viewconfig,
            'genome_assembly'       : (props.context && props.context.genome_assembly) || null,
            'originalViewConfig'    : null, //object.deepClone(props.viewConfig)
            'saveLoading'           : false,
            'cloneLoading'          : false,
            'releaseLoading'        : false,
            'addFileLoading'        : false,
            'modal'                 : null,
            'filesTableSearchHref'  : null,
            'updatedTilesetField'   : null,
            'trackInfo'             : null,
            'tilesetUids'           : {},
            'hgcHeight'             : props.context && props.context.instance_height || 600,
            'viewConfigModified'    : false
        };
        this.higlassRef = React.createRef();
    }

    componentDidUpdate(pastProps, pastState) {
        if (this.props.isFullscreen !== pastProps.isFullscreen) {
            // TODO: Trigger re-draw of HiGlassComponent somehow
        }
    }

    havePermissionToEdit() {
        const { session, context: { actions = [] } } = this.props;
        return !!(session && _.findWhere(actions, { 'name': 'edit' }));
    }

    /**
     * Callback func called by editable field to persist instance height
     * @param {*} hgc   HiGlass component instance
     */
    updateHiGlassComponentHeight(hgc) {
        const { context, isFullscreen, windowHeight } = this.props;
        if (hgc === undefined) {
            let hiGlassComponentHeight;
            if (isFullscreen) {
                hiGlassComponentHeight = windowHeight - 120;
            }
            else {
                hiGlassComponentHeight = context.instance_height;
            }
            this.setState({ 'hgcHeight': hiGlassComponentHeight });
        }
        else {
            this.setState({ 'hgcHeight': hgc.instance_height });
        }
    }

    /**
     * Callback func called by editable fields of files table track width/height/name
     * @param {*} hgc   HiGlass component instance
     */
    updateHiglassViewConf(updatedTilesetField, trackInfo) {
        if (_.has(updatedTilesetField, 'name')) {

            const hgc = this.getHiGlassComponent();
            const currentViewConf = this.getHiGlassViewConfig(hgc);
            if (!currentViewConf) {
                throw new Error('Could not get current view configuration.');
            }

            const track = currentViewConf.views[trackInfo.vIndex].tracks[trackInfo.track];
            const tileset = _.find(track, function (t) { return t.uid === trackInfo.uid; });
            if (tileset) {
                if (trackInfo.track === 'center') {
                    const content = _.find(tileset.contents, function (content) { return content.tilesetUid === trackInfo.tilesetUid; });
                    if (content) {
                        content.options.name = updatedTilesetField.name;
                    }
                } else {
                    tileset.options.name = updatedTilesetField.name;
                }
                hgc.api.setViewConfig(currentViewConf, true);
                this.setState({ 'viewConfigModified': true });
            }
        } else {
            if (!this.hasSimilarTilesets(updatedTilesetField, trackInfo)) {
                this.setState({ 'updatedTilesetField': updatedTilesetField, 'trackInfo': trackInfo }, this.handleUpdateSingleTileset);
            }
            else {
                this.setState({
                    'modal': (
                        <ConfirmModal handleConfirm={this.handleUpdateAllTilesets} handleCancel={this.handleUpdateSingleTileset}
                            confirmButtonText="Yes, Update All" cancelButtonText="No, Update Only This" modalTitle="Update">
                            Do you want to update all similar tilesets?
                            <br />
                        </ConfirmModal>
                    ), 'updatedTilesetField': updatedTilesetField, 'trackInfo': trackInfo
                });
            }
        }
        return true; //currently not in use
    }

    /**
     * Func to update single tileset of Files table updates
     */
    handleUpdateSingleTileset() {
        const { updatedTilesetField, trackInfo } = this.state;
        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf) {
            throw new Error('Could not get current view configuration.');
        }
        const track = currentViewConf.views[trackInfo.vIndex].tracks[trackInfo.track];
        const tileset = _.find(track, function (t) { return t.uid === trackInfo.uid; });

        if (tileset) {
            if (_.has(updatedTilesetField, 'height')) {
                tileset.height = updatedTilesetField.height;
            }
            else if (_.has(updatedTilesetField, 'width')) {
                tileset.width = updatedTilesetField.width;
            }

            hgc.api.setViewConfig(currentViewConf, true);
            this.setState({ 'modal': null, 'viewConfigModified': true });
        }

        return true;
    }
    /**
     * updates similar (within the same view and track, having same orientation and type) tilesets
     * @param {*} evt
     */
    handleUpdateAllTilesets(evt) {
        evt.preventDefault();
        const { updatedTilesetField, trackInfo, filesTableSearchHref } = this.state;

        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf) {
            throw new Error('Could not get current view configuration.');
        }
        const track = currentViewConf.views[trackInfo.vIndex].tracks[trackInfo.track];
        const tileset = _.find(track, function (t) { return t.uid === trackInfo.uid; });

        if (tileset) {
            const { orientation, type } = tileset;
            if (_.has(updatedTilesetField, 'height')) {
                _.each(track, (tilesetItem, idx) => {
                    if (orientation === tilesetItem.orientation && type === tilesetItem.type) {
                        tilesetItem.height = updatedTilesetField.height;
                    }
                });
            }
            else if (_.has(updatedTilesetField, 'width')) {
                _.each(track, (tilesetItem, i) => {
                    if (orientation === tilesetItem.orientation && type === tilesetItem.type) {
                        tilesetItem.width = updatedTilesetField.width;
                    }
                });
            }

            hgc.api.setViewConfig(currentViewConf, true);
            //workaround: force update of files table by re-setting filesTableSearchHref
            const url = new URL(filesTableSearchHref, window.location.href);
            const search_params = url.searchParams;
            search_params.set('hg_files_search_token', new Date().getTime());//assumption: hg_files_search_token is not a valid ES search field
            url.search = search_params.toString();
            const newFilesTableSearchHref = url.pathname + url.search.toString();
            this.setState({ 'modal': null, 'viewConfigModified': true, 'filesTableSearchHref': newFilesTableSearchHref });
        }

        return true;
    }
    /**
     * checks whether multiple similar (within the same view and track, having same orientation and type) tilesets exist
     * @param {Object} updatedTilesetField edited field object
     * @param {Object} trackInfo track info object that holds detail view and track info
     */
    hasSimilarTilesets(updatedTilesetField, trackInfo) {
        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf) {
            throw new Error('Could not get current view configuration.');
        }
        const track = currentViewConf.views[trackInfo.vIndex].tracks[trackInfo.track];
        const tileset = _.find(track, function (t) { return t.uid === trackInfo.uid; });

        if (tileset) {
            const { orientation, type } = tileset;
            const similarTilesets = _.filter(track, (tilesetItem) => orientation === tilesetItem.orientation && type === tilesetItem.type);
            return similarTilesets && similarTilesets.length > 1;
        }
        return false;
    }
    /**
     * Update the current higlass viewconfig for the user, based on the current data.
     * Note that this function is throttled in constructor() to prevent someone clicking it like, 100 times within 3 seconds.
     * @returns {void}
    */
    handleSave(evt){
        const { href, context } = this.props;
        const { genome_assembly, modal } = this.state;
        evt.preventDefault();

        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf){
            throw new Error('Could not get current view configuration.');
        }

        if (!this.havePermissionToEdit()){
            // I guess would also get caught in ajax error callback.
            throw new Error('No edit permissions.');
        }

        if(modal == null && context.status && typeof context.status === 'string' &&
            (context.status === 'released' || context.status === 'released to project')) {
            this.setState({
                'modal': (
                    <ConfirmModal handleConfirm={this.handleSave} handleCancel={this.handleModalCancel}
                        confirmButtonText="Save" cancelButtonText="Cancel" modalTitle="Confirm Save">
                        You are overwriting a HiGlass Display Item that was previously shared with public. Are you sure?
                        <br />Note that you can also clone this display and share the new copy.
                    </ConfirmModal>
                )
            });
            return;
        }
        //default window.confirm dialog
        /*if(!confirm('You are overwriting a HiGlass Display Item that was previously shared with public. Are you sure?\r\n\r\nNote that you can also clone this display and share the new copy.'))
            return;*/

        // We're updating this object's view conf and the genome assembly.
        const payload = { 'viewconfig' : currentViewConf };

        if (genome_assembly){
            // If we always include this and its null, then we get validation error because
            // is not of type string. It must be explictly excluded, not just set to null
            // or undefined.
            payload.genome_assembly = genome_assembly;
        }

        this.setState({ 'saveLoading' : true, 'modal': null }, ()=>{
            ajax.load(
                href,
                (resp)=>{
                    // Success callback... maybe update state.originalViewConfigString or something...
                    // At this point we're saved maybe just notify user somehow if UI update re: state.saveLoading not enough.
                    Alerts.queue({
                        'title' : "Saved " + context.title,
                        'message' : "This HiGlass Display Item has been updated with the current viewport. This may take a few minutes to take effect.",
                        'style' : 'success'
                    });
                    this.setState({ 'saveLoading' : false, 'viewConfigModified': false });
                },
                'PATCH',
                ()=>{
                    // Error callback
                    Alerts.queue({
                        'title' : "Failed to save display.",
                        'message' : "Sorry, can you try to save again?",
                        'style' : 'danger'
                    });
                    this.setState({ 'saveLoading' : false });
                },
                JSON.stringify(payload)
            );
        });
    }

    /**
    * Create a new higlass viewconfig for the user, based on the current data.
    * @returns {void}
    */
    handleClone(evt){
        evt.preventDefault();

        const { context } = this.props;
        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf){
            throw new Error('Could not get current view configuration.');
        }

        // Generate a new title and description based on the current display.
        const userDetails = JWT.getUserDetails();
        let userFirstName = "Unknown";

        if (userDetails && typeof userDetails.first_name === 'string' && userDetails.first_name.length > 0) userFirstName = userDetails.first_name;

        const viewConfTitleAppendStr = " - " + userFirstName + "'s copy";
        const viewConfDesc = context.description;
        let viewConfTitle = context.display_title + viewConfTitleAppendStr; // Default, used if title does not already have " - [this user]'s copy" substring.

        // Check if our title already has " - user's copy" substring and if so,
        // increment an appended counter instead of re-adding the substring.
        if (context.display_title.indexOf(viewConfTitleAppendStr) > -1){
            const regexCheck = new RegExp('(' + viewConfTitleAppendStr + ')\\s\\(\\d+\\)');
            const regexMatches = context.display_title.match(regexCheck);

            if (regexMatches && regexMatches.length === 2) {
                // regexMatches[0] ==> " - user's copy (int)"
                // regexMatches[1] ==> " - user's copy"
                let copyCount = parseInt(
                    regexMatches[0].replace(regexMatches[1], '')
                        .trim()
                        .replace('(', '')
                        .replace(')', '')
                );

                copyCount++;
                viewConfTitle = (
                    context.display_title.replace(regexMatches[0], '') // Remove old " - user's copy (int)" substr
                    + viewConfTitleAppendStr + ' (' + copyCount + ')'  // Add new count
                );
            } else {
                // Our title already has " - user's copy" substring, but not an " (int)"
                viewConfTitle = context.display_title + ' (2)';
            }
        }

        const fallbackCallback = (errResp, xhr) => {
            // Error callback
            Alerts.queue({
                'title' : "Failed to save display.",
                'message' : "Sorry, can you try to save again?",
                'style' : 'danger'
            });
            this.setState({ 'cloneLoading' : false });
        };

        const payload = {
            'title'          : viewConfTitle,
            'description'    : viewConfDesc,
            'viewconfig'     : currentViewConf,
            'instance_height': context.instance_height,
            // We don't include other properties and let them come from schema default values.
            // For example, default status is 'draft', which will be used.
            // Lab and award do not carry over as current user might be from different lab.
        };

        if (this.state.genome_assembly){
            payload.genome_assembly = this.state.genome_assembly;
        }
        // Try to POST/PUT a new viewconf.
        this.setState(
            { 'cloneLoading' : true },
            () => {
                ajax.load(
                    '/higlass-view-configs/',
                    (resp) => { // We're likely to get a status code of 201 - Created.
                        this.setState({ 'cloneLoading' : false }, ()=>{
                            const newItemHref = object.itemUtil.atId(resp['@graph'][0]);

                            // Redirect the user to the new Higlass display.
                            navigate(newItemHref, {}, (resp)=>{
                                // Show alert on new Item page
                                Alerts.queue({
                                    'title'     : "Saved " + viewConfTitle,
                                    'message'   : "Saved new display.",
                                    'style'     : 'success'
                                });
                            });
                        });
                    },
                    'POST',
                    fallbackCallback,
                    JSON.stringify(payload)
                );
            }
        );

    }
    /**
    * Cancel/hide modal popup
    * @returns {void}
    */
    handleModalCancel() {
        this.setState({ 'modal': null });
    }

    /**
    * Update the current Viewconf to add a new view with the file(s) with the given uuid.
    * @returns {void}
    */
    addFileToHiglass(files) {
        const { href } = this.props;
        const hgc = this.getHiGlassComponent();
        const currentViewConf = this.getHiGlassViewConfig(hgc);

        if (!currentViewConf){
            throw new Error('Could not get current view configuration.');
        }

        // Read the url of the higlass viewconfig and store the genome assembly.
        ajax.load(
            href,
            (resp)=>{
                if(resp.success) {
                    this.setState({ 'genome_assembly' : resp.genome_assembly });
                }
            },
            'GET'
        );

        // Get the x and y scales of the first view.
        let firstViewLocationAndZoom = [null, null, null];
        if (currentViewConf.views && currentViewConf.views.length > 0) {
            const firstViewUid = currentViewConf.views[0].uid;

            const xScale = hgc.xScales[firstViewUid];
            const yScale = hgc.yScales[firstViewUid];

            // Transform the first view's location and zoom levels.
            const xCenter = xScale.invert((xScale.range()[0] + xScale.range()[1]) / 2);
            const yCenter = yScale.invert((yScale.range()[0] + yScale.range()[1]) / 2);
            const k = xScale.invert(1) - xScale.invert(0);

            firstViewLocationAndZoom = [xCenter, yCenter, k];
        }

        const payload = {
            'higlass_viewconfig'        : currentViewConf,
            'genome_assembly'           : this.state.genome_assembly,
            'files'                     : files,
            'firstViewLocationAndZoom'  : firstViewLocationAndZoom
        };

        // If it failed, show the error in the popup window.
        const fallbackCallback = (errResp, xhr) => {
            // Error callback
            Alerts.queue({
                'title' : "Failed to add file.",
                'message' : errResp.errors,
                'style' : 'danger'
            });
            this.setState({ 'addFileLoading' : false });
        };

        // Make an AJAX call to add the file.
        this.setState(
            { addFileLoading : true },
            () => {
                ajax.load(
                    "/add_files_to_higlass_viewconf/",
                    (resp) => {
                        const stateChange = { 'addFileLoading' : false };
                        if (resp.success) {
                            // Update the genome assembly and view config.
                            if (resp.new_genome_assembly) {
                                stateChange["genome_assembly"] = resp.new_genome_assembly;
                            }
                            stateChange["viewConfig"] = resp.new_viewconfig;
                        }

                        this.setState(stateChange, ()=>{
                            // If it failed, return an error message.
                            if (!resp.success) {
                                return fallbackCallback(resp);
                            }

                            const filesLen = files.length;

                            // Show alert indicating success
                            Alerts.queue({
                                'title'     : "Added file" + (filesLen === 1 ? "" : "s"),
                                'message'   : "Added " + filesLen + " new file" + (filesLen === 1 ? "" : "s") + " to Higlass display.",
                                'style'     : 'success'
                            });
                        });
                    },
                    'POST',
                    fallbackCallback,
                    JSON.stringify(payload)
                );
            }
        );
    }

    /**
    * Copies current URL to clipbard.
    * Sets the higlass display status to released if it isn't already.
    *
    * @returns {void}
    */
    handleStatusChange(statusToSet = 'released', evt) {
        evt.preventDefault();

        const { context, href } = this.props;
        const viewConfTitle = context.title || context.display_title;

        // If the view config has already been released, just copy the URL to the clipboard and return.
        if (context.status === statusToSet) {
            return;
        }

        if (!this.havePermissionToEdit()){
            throw new Error('No edit permissions.');
        }

        // PATCH `status: released` to current href, then in a callback, copy the URL to the clipboard.
        this.setState(
            { 'releaseLoading' : true },
            ()=>{
                ajax.load(
                    href,
                    (resp)=>{
                        // Success! Generate an alert telling the user it's successful
                        this.setState({ 'releaseLoading' : false });
                        Alerts.queue({
                            'title'     : "Updated Status for " + viewConfTitle,
                            'message'   : (
                                <p className="mb-02">
                                    Changed Display status to <b>{ statusToSet }</b>.
                                    It may take some time for this edit to take effect.
                                </p>
                            ),
                            'style'     : 'info'
                        });
                    },
                    'PATCH',
                    (resp)=>{
                        // Error callback
                        this.setState({ 'releaseLoading' : false });
                        Alerts.queue({
                            'title'     : "Failed to release display.",
                            'message'   : "Sorry, can you try to share again?",
                            'style'     : 'danger'
                        });
                    },
                    JSON.stringify({
                        'status' : statusToSet
                    })
                );
            }
        );
    }

    getHiGlassComponent(){
        return (this.higlassRef && this.higlassRef.current && this.higlassRef.current.getHiGlassComponent()) || null;
    }

    getHiGlassViewConfig(hgc){
        const currentViewConfStr = hgc && hgc.api.exportAsViewConfString();
        const currentViewConf = currentViewConfStr && JSON.parse(currentViewConfStr);

        return currentViewConf;
    }

    statusChangeButton(){
        const { session, context } = this.props;
        const { releaseLoading } = this.state;
        const editPermission = this.havePermissionToEdit();

        if (!session || !editPermission) return null; // TODO: Remove and implement for anon users. Eventually.

        const btnProps = {
            'onSelect'      : this.handleStatusChange,
            //'onClick'       : context.status === 'released' ? null : this.handleStatusChangeToRelease,
            'variant'       : context.status === 'released' ? 'outline-dark' : 'info',
            'disabled'      : releaseLoading,
            'key'           : 'statuschangebtn',
            'data-tip'      : "Change the visibility/permissions of this HiGlass Display",
            'title'         : (
                <React.Fragment>
                    <i className={"icon icon-fw icon-" + (releaseLoading ? 'circle-notch fas icon-spin' : 'id-badge far')}/>&nbsp; Manage
                </React.Fragment>
            ),
            'pullRight'     : true
        };

        return (
            <DropdownButton {...btnProps}>
                <StatusMenuItem eventKey="released" context={context}>Visible by Everyone</StatusMenuItem>
                <StatusMenuItem eventKey="released to project" context={context}>Visible by Network</StatusMenuItem>
                <StatusMenuItem eventKey="released to lab" context={context}>Visible by Lab</StatusMenuItem>
                <StatusMenuItem eventKey="draft" context={context}>Private</StatusMenuItem>
                <Dropdown.Divider />
                {/* These statuses currently not available.
                <StatusMenuItem active={context.status === "archived to project"} eventKey="archived to project">Archive to Project</StatusMenuItem>
                <StatusMenuItem active={context.status === "archived"} eventKey="archived">Archive to Lab</StatusMenuItem>
                */}
                <StatusMenuItem eventKey="deleted" context={context}>Delete</StatusMenuItem>
            </DropdownButton>
        );
    }

    saveButton(){
        const { saveLoading } = this.state;
        const tooltip = "Save the current view shown below to this display";

        const editPermission = this.havePermissionToEdit();

        return (
            <button type="button" onClick={this.handleSave} disabled={!editPermission || saveLoading} className="btn btn-success" key="savebtn" data-tip={tooltip}>
                <i className={"icon icon-fw icon-" + (saveLoading ? 'circle-notch icon-spin fas' : 'save fas')}/>&nbsp; Save
            </button>
        );
    }

    cloneButton(){
        const { session } = this.props;
        const { cloneLoading } = this.state;
        const tooltip = "Create your own new HiGlass Display based off of this one";

        return (
            <button type="button" onClick={this.handleClone} disabled={!session || cloneLoading} className="btn btn-success" key="clonebtn" data-tip={tooltip}>
                <i className={"icon icon-fw icon-" + (cloneLoading ? 'circle-notch icon-spin fas' : 'clone far')}/>&nbsp; Clone
            </button>
        );
    }

    copyURLButton(){
        const { windowWidth, href } = this.props;
        const gridState = layout.responsiveGridState(windowWidth);
        const isMobile = gridState !== 'lg' && gridState !== 'xl';
        return (
            <object.CopyWrapper data-tip="Copy view URL to clipboard to share with others." includeIcon={false} wrapperElement="button" value={href}>
                <i className="icon icon-fw icon-copy far"/>
                {isMobile ?
                    <React.Fragment>
                        &nbsp;&nbsp; Copy URL
                    </React.Fragment>
                    : null}
            </object.CopyWrapper>
        );
    }

    /**
     * Is used to call {function} `props.toggleFullScreen` which is passed down from app.js BodyElement.
     * Calls it in a setTimeout because HiGlassComponent may hang JS/UI thread as it refits/calculates itself
     * in response to new `width` and `height` props passed to it.
     */
    handleFullscreenToggle(){
        const { isFullscreen, toggleFullScreen } = this.props;
        setTimeout(toggleFullScreen, 0, !isFullscreen);
    }

    fullscreenButton(){
        const { isFullscreen, toggleFullScreen } = this.props;
        if(typeof isFullscreen === 'boolean' && typeof toggleFullScreen === 'function'){
            return (
                <button type="button" className="btn btn-outline-dark" onClick={this.handleFullscreenToggle} data-tip={!isFullscreen ? 'Expand to full screen' : null}>
                    <i className={"icon icon-fw fas icon-" + (!isFullscreen ? 'expand' : 'compress')}/>
                </button>
            );
        }
        return null;
    }

    collapseButtonTitle(isOpen){
        return (
            <React.Fragment>
                <i className={"icon icon-fw fas icon-" + (isOpen ? 'angle-up' : 'bars')}/>&nbsp; Menu
            </React.Fragment>
        );
    }

    onViewConfigUpdated(viewConf){
        const { tilesetUids: oldData } = this.state;
        const newData = HiGlassViewConfigTabView.getTilesetUids(JSON.parse(viewConf));

        if (!_.isEqual(oldData, newData)) {
            const newDataKeys = _.keys(newData);
            const searchHref = (newDataKeys.length > 0 ? "/search/?type=File&higlass_uid=" + newDataKeys.sort().join('&higlass_uid=') : null) + "&sort=-tags&sort=-date_created";
            this.setState({ 'tilesetUids': newData, 'filesTableSearchHref': searchHref });
        }
    }

    renderFilesDetailPane(result, rowNumber, containerWidth){
        const { schemas } = this.props;
        const { tilesetUids } = this.state;
        const tracks = tilesetUids && result.higlass_uid && tilesetUids[result.higlass_uid] ? tilesetUids[result.higlass_uid] : [];

        return <HiGlassFileDetailPane {...{ result, schemas, handleCustomSave: this.updateHiglassViewConf, viewConfigTracks: tracks }} />;
    }

    render(){
        const { context, isFullscreen, windowWidth, width, session, schemas, href } = this.props;
        const { addFileLoading, genome_assembly, viewConfig, modal, tilesetUids, filesTableSearchHref, hgcHeight, viewConfigModified } = this.state;
        const hiGlassComponentWidth = isFullscreen ? windowWidth : width + 20;
        let hgcHeightField = null;
        // If the user isn't logged in, add a tooltip reminding them to log in.
        let tooltip = null;
        if (!session) {
            tooltip = "Log in to be able to clone, save, and share HiGlass Displays";
        }
        if (this.havePermissionToEdit()) {
            hgcHeightField = (
                <FieldSet
                    context={context}
                    lineHeight={22}
                    dimensions={{
                        'paddingWidth': 0,
                        'paddingHeight': 22,
                        'buttonWidth': 30,
                        'initialHeight': 42
                    }}
                    onSave={this.updateHiGlassComponentHeight}
                    className="mt-1" schemas={schemas} href={href}>
                    <EditableField label="Instance Height" labelID="instance_height" style="row-without-label" fallbackText="No intance data" fieldType="numeric" dataType="int" buttonAlwaysVisible={true} inputSize="md">
                        <i className="visible-lg-inline icon icon-fw icon-arrows-alt-v fas" />&nbsp; {hgcHeight}
                    </EditableField>
                </FieldSet>);
        }
        const filesTableProps = {
            schemas, width,
            searchHref: filesTableSearchHref,
            hideColumns: ['@type'],
            renderDetailPane: this.renderFilesDetailPane,
            maxHeight: 800,
            defaultOpenIndices: [0],
            facets: null
        };

        const notPersistentMessage = (<Fade in appear timeout={700}><span className="text-200"> - <mark>Your change(s) are not persistent yet. Click Save or Clone to save.</mark></span></Fade>);

        return (
            <div className={"overflow-hidden tabview-container-fullscreen-capable" + (isFullscreen ? ' full-screen-view' : '')}>
                <h3 className="tab-section-title">
                    <AddFileButton onClick={this.addFileToHiglass} loading={addFileLoading} genome_assembly={genome_assembly}
                        className="btn-success mt-17" style={{ 'paddingLeft' : 30, 'paddingRight' : 30 }} />
                    <CollapsibleItemViewButtonToolbar tooltip={tooltip} windowWidth={windowWidth}
                        constantButtons={this.fullscreenButton()} collapseButtonTitle={this.collapseButtonTitle}>
                        {this.saveButton()}
                        {this.cloneButton()}
                        {this.statusChangeButton()}
                    </CollapsibleItemViewButtonToolbar>
                </h3>
                <hr className="tab-section-title-horiz-divider" />
                <div className="higlass-tab-view-contents">
                    <div className="higlass-container-container" style={isFullscreen ? { 'paddingLeft': 10, 'paddingRight': 10 } : null}>
                        <HiGlassPlainContainer {..._.omit(this.props, 'context', 'viewConfig')}
                            width={hiGlassComponentWidth} height={hgcHeight} viewConfig={viewConfig}
                            ref={this.higlassRef} onViewConfigUpdated={this.onViewConfigUpdated} />
                    </div>
                </div>
                {filesTableSearchHref || hgcHeightField ?
                    (
                        <React.Fragment>
                            <hr className="tab-section-title-horiz-divider" />
                            {hgcHeightField}
                            {filesTableSearchHref ?
                                (
                                    <div className="raw-files-table-section">
                                        <h3 className="tab-section-title">
                                            <span>
                                                <span className="text-400">{_.keys(tilesetUids).length}</span> File(s) {viewConfigModified ? notPersistentMessage : null}
                                            </span>
                                        </h3>
                                        <EmbeddedItemSearchTable {...filesTableProps} facets={null} />
                                    </div>
                                ) : null}
                        </React.Fragment>
                    ) : null
                }
                {modal}
            </div>
        );
    }
}

function HiGlassFileDetailPane(props) {
    const { windowWidth, href, viewConfigTracks = null, schemas, handleCustomSave } = props;
    // If we pass empty array as 2nd arg, the `useEffect` hook should act exactly like componentDidMount
    // See last "Note" under https://reactjs.org/docs/hooks-effect.html as well as this article - https://medium.com/@felippenardi/how-to-do-componentdidmount-with-react-hooks-553ba39d1571
    useEffect(function () {
        ReactTooltip.rebuild(); // Rebuild tooltips, many of which are present on `Detail` list.
    }, []);

    const tracksBody = _.map(viewConfigTracks, (item, idx) => {
        let width = null;
        let height = null;
        item['name'] = item['title'];
        if (item.track === 'top' || item.track === 'bottom') {
            width = (item.width) ? (item.width || '-') : "-";
            height =
                <FieldSet context={item}
                    schemas={schemas} href={href}>
                    <EditableField labelID="height" fallbackText="-" style="inline" fieldType="numeric" handleCustomSave={handleCustomSave} dataType="int" buttonAlwaysVisible={true}>
                    </EditableField>
                </FieldSet>;
        }
        else if (item.track === 'left' || item.track === 'right') {
            height = (item.height) ? (item.height || '-') : "-";
            width =
                <FieldSet context={item}>
                    <EditableField labelID="width" fallbackText="-" style="inline" fieldType="numeric" handleCustomSave={handleCustomSave} dataType="int" buttonAlwaysVisible={true}>
                    </EditableField>
                </FieldSet>;
        }
        return (
            <tr>
                <td>{item.view}</td><td>{item.track}</td><td>{width}</td><td>{height}</td>
                <td>
                    <FieldSet context={item}
                        lineHeight={22}
                        dimensions={{
                            'paddingWidth': 0,
                            'paddingHeight': 22,
                            'buttonWidth': 30,
                            'initialHeight': 42
                        }}
                        windowWidth={windowWidth}
                        schemas={schemas} href={href}>
                        <EditableField labelID="name" fallbackText="no data" fieldType="text" style="inline" handleCustomSave={handleCustomSave} outerClassName="w-100" buttonAlwaysVisible={true}>
                        </EditableField>
                    </FieldSet>
                </td>
            </tr>);
    });

    return (
        <div className="mr-1">
            {!viewConfigTracks ? null : (
                <div className="flex-description-container">
                    <h5><i className="icon icon-fw icon-align-left mr-08 fas" />Tracks</h5>
                    <div className="row ml-27 mr-0">
                        <table style={{ minWidth: '100%' }}>
                            <thead>
                                <tr>
                                    <th><div className="tooltip-info-container"><span>In View</span></div></th>
                                    <th><div className="tooltip-info-container"><span>Track Position&nbsp;<i data-tip="Position of track" className="icon fas icon-info-circle" currentitem="false"></i></span></div></th>
                                    <th><div className="tooltip-info-container"><span>Width&nbsp;<i data-tip="Width of track" className="icon fas icon-info-circle" currentitem="false"></i></span></div></th>
                                    <th><div className="tooltip-info-container"><span>Height&nbsp;<i data-tip="Height of track" className="icon fas icon-info-circle" currentitem="false"></i></span></div></th>
                                    <th><div className="tooltip-info-container"><span>Title</span></div></th>
                                </tr>
                            </thead>
                            <tbody>
                                {tracksBody}
                            </tbody>
                        </table>
                    </div>

                    <hr className="desc-separator" />
                </div>
            )}
            {/* <h5 className="text-500 mb-0 mt-16">
                <i className="icon icon-fw icon-list fas mr-08" />Details
            </h5>
            <div className="item-page-detail ml-27">
                <Detail context={result} open={false} schemas={schemas} excludedKeys={HiGlassFileDetailPane.excludedKeys} />
            </div> */}
        </div>
    );
}
// HiGlassFileDetailPane.excludedKeys = [
//     ...Detail.defaultProps.excludedKeys,
//     "title", "genome_assembly", "md5sum", "content_md5sum", "source_experiments", "upload_key", "tsv_notes",
//     "track_and_facet_info", "static_content", "filename", "file_format", "file_size", "file_type", "file_type_detailed",
//     "aliases", "tags", "alternate_accessions", "public_release", "contributing_labs", "href", "produced_from"
// ];

/**
 * This Component has a button and a text input and a button.
 * You will type a file uuid into the field and click the button to accept.
 */
class AddFileButton extends React.PureComponent {

    static propTypes = {
        'onClick' : PropTypes.func.isRequired,
        'loading' : PropTypes.bool.isRequired,
        'className' : PropTypes.string
    };

    static defaultProps = {
        'className' : "btn-success"
    };

    constructor(props){
        super(props);
        this.receiveFile            = this.receiveFile.bind(this);
        this.setIsSelecting         = _.throttle(this.toggleIsSelecting.bind(this, true), 3000, { 'trailing' : false });
        this.unsetIsSelecting       = this.toggleIsSelecting.bind(this, false);
        this.toggleIsSelecting      = this.toggleIsSelecting.bind(this);
        this.state = {
            'isSelecting': false
        };
    }

    toggleIsSelecting(isSelecting){
        this.setState(function(currState){
            if (typeof isSelecting !== 'boolean') isSelecting = !currState.isSelecting;
            if (isSelecting === currState.isSelecting) return null;
            return { isSelecting };
        });
    }

    receiveFile(items, endDataPost) {
        if (!items || !Array.isArray(items) || items.length === 0 || !_.every(items, function (item) { return item.id && typeof item.id === 'string' && item.json; })) {
            return;
        }
        endDataPost = (endDataPost !== 'undefined' && typeof endDataPost === 'boolean') ? endDataPost : true;
        this.setState({ 'isSelecting' : !endDataPost }, ()=>{
            // Invoke the object callback function, using the text input.
            this.props.onClick(_.pluck(items, 'id'));
        });
    }

    render(){
        const { loading, genome_assembly, className, style } = this.props;
        const { isSelecting } = this.state;
        const tooltip         = "Search for a file and add it to the display.";
        const dropMessage     = "Drop a File here.";
        const searchURL       = (
            '/search/?currentAction=multiselect&type=File&track_and_facet_info.track_title!=No+value&higlass_uid!=No+value'
            + (genome_assembly ? '&genome_assembly=' + encodeURIComponent(genome_assembly) : '')
        );
        const cls = "btn" + (className ? " " + className : "");

        return (
            <React.Fragment>
                <button type="button" onClick={this.setIsSelecting} disabled={loading} data-tip={tooltip} style={style} className={cls}>
                    <i className={"mr-08 icon icon-fw fas icon-" + (loading ? 'circle-notch icon-spin' : 'plus')}/>Add Data
                </button>
                <LinkToSelector isSelecting={isSelecting} onSelect={this.receiveFile} onCloseChildWindow={this.unsetIsSelecting} dropMessage={dropMessage} searchURL={searchURL} childWindowAlert={null} />
            </React.Fragment>
        );
    }
}

function StatusMenuItem(props){
    const { eventKey, context, children } = props;
    const active = context.status === eventKey;
    return (
        <DropdownItem {..._.omit(props, 'context')} active={active}>
            <span className={active ? "text-500" : null}>
                <i className="item-status-indicator-dot" data-status={eventKey} />&nbsp;  {children}
            </span>
        </DropdownItem>
    );
}


/**
 * Generic modal dialog popup. Customizable title, confirm/cancel button's text.
 * TODO: this component can be moved to another file for generic use in portal.
 */
export const ConfirmModal = React.memo(function (props) {
    const { handleConfirm, handleCancel, modalTitle, confirmButtonText = "OK", cancelButtonText = "Cancel" } = props;
    const confirmButtonEl = useRef(null);
    useEffect(() => {
        confirmButtonEl.current.focus();
    }, []);
    return (
        <Modal show onHide={handleCancel}>
            <Modal.Header closeButton>
                <Modal.Title>{modalTitle || 'Confirm'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {props.children || ''}
            </Modal.Body>
            <Modal.Footer>
                <button type="button" onClick={handleConfirm} className="btn btn-success" ref={confirmButtonEl}>
                    <i className="icon icon-fw icon-check mr-05 fas" />{confirmButtonText || 'OK'}
                </button>
                <button type="button" onClick={handleCancel} className="btn btn-outline-warning">
                    <i className="icon icon-fw icon-times mr-05 fas" />{cancelButtonText || 'Cancel'}
                </button>
            </Modal.Footer>
        </Modal>);
});
ConfirmModal.PropTypes = {
    'handleConfirm': PropTypes.func.isRequired,
    'handleCancel': PropTypes.func.isRequired,
    'modalTitle': PropTypes.string,
    'confirmButtonText': PropTypes.string,
    'cancelButtonText': PropTypes.string
};
