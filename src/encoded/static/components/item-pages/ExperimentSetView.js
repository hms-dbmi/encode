'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import memoize from 'memoize-one';

import Collapse from 'react-bootstrap/esm/Collapse';
import { FlexibleDescriptionBox } from '@hms-dbmi-bgm/shared-portal-components/es/components/ui/FlexibleDescriptionBox';
import { console, object, isServerSide, layout, commonFileUtil, schemaTransforms } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { expFxn, Schemas, typedefs } from './../util';

import { HiGlassAjaxLoadContainer } from './components/HiGlass/HiGlassAjaxLoadContainer';
import { HiGlassPlainContainer, isHiglassViewConfigItem } from './components/HiGlass/HiGlassPlainContainer';
import { AdjustableDividerRow } from './components/AdjustableDividerRow';
import { OverviewHeadingContainer } from './components/OverviewHeadingContainer';
import { OverViewBodyItem } from './DefaultItemView';
import WorkflowRunTracingView, { FileViewGraphSection } from './WorkflowRunTracingView';
import { QCMetricFromSummary } from './QualityMetricView';

import { RawFilesStackedTableExtendedColumns, ProcessedFilesStackedTable, renderFileQCReportLinkButton, renderFileQCDetailLinkButton } from './../browse/components/file-tables';
import { SelectedFilesController, uniqueFileCount } from './../browse/components/SelectedFilesController';
import { SelectedFilesDownloadButton } from './../browse/components/above-table-controls/SelectedFilesDownloadButton';
import { EmbeddedHiglassActions } from './../static-pages/components';
import { combineExpsWithReplicateNumbersForExpSet } from './../util/experiments-transforms';
import { StackedBlockTable, StackedBlock, StackedBlockList, StackedBlockName, StackedBlockNameLabel } from '@hms-dbmi-bgm/shared-portal-components/es/components/browse/components/StackedBlockTable';

// eslint-disable-next-line no-unused-vars
const { Item, File, ExperimentSet } = typedefs;

// import { SET } from './../testdata/experiment_set/replicate_4DNESDG4HNP9';
// import { SET } from './../testdata/experiment_set/replicate_with_bigwigs';




/**
 * ExperimentSet Item view/page.
 *
 * @prop {Object} schemas - state.schemas passed down from app Component.
 * @prop {ExperimentSet} context - JSON representation of current ExperimentSet item.
 */
export default class ExperimentSetView extends WorkflowRunTracingView {

    static shouldShowSupplementaryFilesTabView = memoize(function(context){
        const opfCollections = SupplementaryFilesTabView.combinedOtherProcessedFiles(context);
        const referenceFiles = SupplementaryFilesTabView.allReferenceFiles(context);
        return (opfCollections.length > 0 || referenceFiles.length > 0);
    });

    /** Preserve selected files if href changes (due to `#tab-id`), unlike the default setting for BrowseView. */
    static resetSelectedFilesCheck(nextProps, pastProps){
        if (nextProps.context !== pastProps.context) return true;
        return false;
    }

    static propTypes = {
        'schemas' : PropTypes.object,
        'context' : PropTypes.object.isRequired
    };

    constructor(props){
        super(props);
        _.bindAll(this, 'isWorkflowNodeCurrentContext', 'getTabViewContents', 'shouldGraphExist');
        this.allProcessedFilesFromExperimentSet = memoize(expFxn.allProcessedFilesFromExperimentSet);
        this.allFilesFromExperimentSet = memoize(expFxn.allFilesFromExperimentSet);

        /**
         * Explicit self-assignment to remind that we inherit the following properties from WorkfowRunTracingView:
         * `loadingGraphSteps`, `allRuns`, `steps`, & `mounted`
         */
        this.state = this.state;
    }

    shouldGraphExist(){
        const { context } = this.props;
        const processedFiles = this.allProcessedFilesFromExperimentSet(context);
        const processedFilesLen = (processedFiles && processedFiles.length) || 0;
        return processedFilesLen > 0;
    }

    isWorkflowNodeCurrentContext(node){
        var ctx = this.props.context;
        if (!ctx) return false;
        if (!node || !node.meta || !node.meta.run_data || !node.meta.run_data.file) return false;
        if (Array.isArray(node.meta.run_data.file)) return false;
        if (typeof node.meta.run_data.file.accession !== 'string') return false;
        if (!ctx.processed_files || !Array.isArray(ctx.processed_files) || ctx.processed_files.length === 0) return false;
        if (_.contains(_.pluck(ctx.processed_files, 'accession'), node.meta.run_data.file.accession)) return true;
        return false;
    }

    /**
     * Executed on width change, as well as this ItemView's prop change.
     */
    getTabViewContents(){
        const { context, schemas, windowWidth, windowHeight, href, session } = this.props;
        const { mounted } = this.state;

        //context = SET; // Use for testing along with _testing_data

        const processedFiles = this.allProcessedFilesFromExperimentSet(context);
        const processedFilesLen = (processedFiles && processedFiles.length) || 0;
        const rawFiles = this.allFilesFromExperimentSet(context, false);
        const rawFilesLen = (rawFiles && rawFiles.length) || 0;
        const width = this.getTabViewWidth();

        const commonProps = { width, context, schemas, windowWidth, href, session, mounted };
        const propsForTableSections = _.extend(SelectedFilesController.pick(this.props), commonProps);

        var tabs = [];

        // Processed Files Table Tab
        if (processedFilesLen > 0){
            tabs.push({
                tab : <span><i className="icon icon-microchip fas icon-fw"/>{ ' ' + processedFilesLen + " Processed File" + (processedFilesLen > 1 ? 's' : '') }</span>,
                key : 'processed-files',
                content : (
                    <SelectedFilesController resetSelectedFilesCheck={ExperimentSetView.resetSelectedFilesCheck} initiallySelectedFiles={processedFiles}>
                        <ProcessedFilesStackedTableSection {...propsForTableSections} files={processedFiles} />
                    </SelectedFilesController>
                )
            });
        }

        // Raw files tab, if have experiments with raw files
        if (rawFilesLen > 0){
            tabs.push({
                tab : <span><i className="icon icon-leaf fas icon-fw"/>{ ' ' + rawFilesLen + " Raw File" + (rawFilesLen > 1 ? 's' : '') }</span>,
                key : 'raw-files',
                content : (
                    <SelectedFilesController resetSelectedFilesCheck={ExperimentSetView.resetSelectedFilesCheck} initiallySelectedFiles={rawFiles}>
                        <RawFilesStackedTableSection {...propsForTableSections} files={rawFiles} />
                    </SelectedFilesController>
                )
            });
        }

        // Graph Section Tab
        if (this.shouldGraphExist()){
            tabs.push(FileViewGraphSection.getTabObject(
                _.extend({}, this.props, { 'isNodeCurrentContext' : this.isWorkflowNodeCurrentContext }),
                this.state,
                this.handleToggleAllRuns,
                width
            ));
        }

        // Supplementary Files Tab
        if (ExperimentSetView.shouldShowSupplementaryFilesTabView(context)){
            //const referenceFiles = SupplementaryFilesTabView.allReferenceFiles(context) || [];
            //const opfCollections = SupplementaryFilesTabView.combinedOtherProcessedFiles(context) || [];
            //const allOpfFiles = _.reduce(opfCollections, function (memo, coll) { return memo.concat(coll.files || []); }, []);
            //const allFiles = referenceFiles.concat(allOpfFiles);
            tabs.push({
                tab : <span><i className="icon icon-copy far icon-fw"/> Supplementary Files</span>,
                key : 'supplementary-files',
                content: (
                    <SelectedFilesController resetSelectedFilesCheck={ExperimentSetView.resetSelectedFilesCheck} initiallySelectedFiles={[]/*allFiles*/}>
                        <SupplementaryFilesTabView {...propsForTableSections} {...this.state} />
                    </SelectedFilesController>
                )
            });
        }

        return _.map(tabs.concat(this.getCommonTabs()), function(tabObj){
            return _.extend(tabObj, {
                'style' : {
                    'minHeight' : Math.max(mounted && !isServerSide() && (windowHeight - 180), 100) || 800
                }
            });
        });
    }

    itemMidSection(){
        const { context, schemas } = this.props;
        return (
            <React.Fragment>
                { super.itemMidSection() }
                <OverviewHeading context={context} schemas={schemas} key="overview" className="with-background mb-2 mt-1"
                    title="Experiment Set Properties" prependTitleIcon prependTitleIconFxn={prependOverviewHeadingTitleIcon} />
            </React.Fragment>
        );
    }
}


const OverviewHeading = React.memo(function OverviewHeading(props){
    const { context, schemas } = props;
    const tips = object.tipsFromSchema(schemas, context);
    const commonProps = { 'result' : context, 'tips' : tips, 'wrapInColumn' : 'col-sm-6 col-md-3' };
    return (
        <OverviewHeadingContainer {...props}>
            {/* <OverViewBodyItem result={expSet} tips={tips} property='award.project' fallbackTitle="Project" wrapInColumn={col} /> */}
            <OverViewBodyItem {...commonProps} property="experimentset_type" fallbackTitle="Set Type" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.biosample.biosource.individual.organism" fallbackTitle="Organism" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.biosample.biosource.biosource_type" fallbackTitle="Biosource Type" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.biosample.biosource_summary" fallbackTitle="Biosource" />

            <OverViewBodyItem {...commonProps} property="experiments_in_set.experiment_type" fallbackTitle="Experiment Type(s)" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.biosample.modifications.modification_type" fallbackTitle="Modification Type" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.biosample.treatments.treatment_type" fallbackTitle="Treatment Type" />
            <OverViewBodyItem {...commonProps} property="experiments_in_set.experiment_categorizer.combined" fallbackTitle="Assay Details"
                titleRenderFxn={OverviewHeading.expCategorizerTitle} wrapInColumn="col-sm-6 col-md-3 pull-right" />

            <OverViewBodyItem {...commonProps} property="sample_image" fallbackTitle="Sample Image"
                wrapInColumn="col-sm-6 col-md-3" singleItemClassName="block"
                titleRenderFxn={OverViewBodyItem.titleRenderPresets.embedded_item_with_image_attachment} hideIfNoValue />

            <OverViewBodyItem {...commonProps} property="imaging_paths" fallbackTitle="Imaging Paths"
                wrapInColumn="col-sm-6 col-md-9" listItemElement="div" listWrapperElement="div" singleItemClassName="block"
                titleRenderFxn={OverViewBodyItem.titleRenderPresets.imaging_paths_from_exp} hideIfNoValue />

        </OverviewHeadingContainer>
    );
});

// eslint-disable-next-line react/display-name
function prependOverviewHeadingTitleIcon(open, props){
    return <i className="expand-icon icon icon-list icon-fw fas" />;
}

const expCategorizerTitleRenderFxn = memoize(function(field, val, allowJX = true, includeDescriptionTips = true, index = null, wrapperElementType = 'li', fullObject = null){
    let expCatObj = _.uniq(object.getNestedProperty(fullObject, 'experiments_in_set.experiment_categorizer'), false, 'combined');
    expCatObj = (Array.isArray(expCatObj) && expCatObj.length === 1 && expCatObj[0]) || expCatObj;
    if (expCatObj && expCatObj.combined && expCatObj.field && typeof expCatObj.value !== 'undefined'){
        return <span><span className="text-500">{ expCatObj.field }:</span> { expCatObj.value }</span>;
    }
    return OverViewBodyItem.titleRenderPresets.default(...arguments);
});


export class RawFilesStackedTableSection extends React.PureComponent {

    static selectedFilesUniqueCount = memoize(uniqueFileCount);

    renderHeader(){
        const { context, files, selectedFiles, session } = this.props;
        const selectedFilesUniqueCount = RawFilesStackedTableSection.selectedFilesUniqueCount(selectedFiles);
        const fileCount = files.length;
        const filenamePrefix = (context.accession || context.display_title) + "_raw_files_";

        return (
            <h3 className="tab-section-title">
                <span className="text-400">{ fileCount }</span>{ ' Raw File' + (fileCount > 1 ? 's' : '')}
                { selectedFiles ? // Make sure data structure is present (even if empty)
                    <div className="download-button-container pull-right" style={{ marginTop : -10 }}>
                        <SelectedFilesDownloadButton {...{ selectedFiles, filenamePrefix, context, session }} disabled={selectedFilesUniqueCount === 0}
                            id="expset-raw-files-download-files-btn" analyticsAddFilesToCart>
                            <i className="icon icon-download fas icon-fw mr-07 align-baseline"/>
                            <span className="d-none d-sm-inline">Download </span>
                            <span className="count-to-download-integer">{ selectedFilesUniqueCount }</span>
                            <span className="d-none d-sm-inline text-400"> Raw Files</span>
                        </SelectedFilesDownloadButton>
                    </div>
                    : null }
            </h3>
        );
    }

    render(){
        const { context, files } = this.props;
        const anyFilesWithMetrics = !!(commonFileUtil.filterFilesWithEmbeddedMetricItem(files, true));
        return (
            <div className="overflow-hidden">
                { this.renderHeader() }
                <div className="exp-table-container">
                    <RawFilesStackedTableExtendedColumns {..._.extend(_.pick(this.props, 'width', 'windowWidth', 'href'), SelectedFilesController.pick(this.props))}
                        experimentSet={context} showMetricColumns={anyFilesWithMetrics} collapseLongLists={true} collapseLimit={10} collapseShow={7} analyticsImpressionOnMount />
                </div>
            </div>
        );
    }
}

/**
 * TODO: Move to HiGlassTabView.js ?
 */
class HiGlassAdjustableWidthRow extends React.PureComponent {

    static propTypes = {
        'width' : PropTypes.number.isRequired,
        'mounted' : PropTypes.bool.isRequired,
        'renderRightPanel' : PropTypes.func,
        'windowWidth' : PropTypes.number.isRequired,
        'higlassItem' : PropTypes.object,
        'minOpenHeight' : PropTypes.number,
        'maxOpenHeight' : PropTypes.number,
        'renderLeftPanelPlaceholder' : PropTypes.func,
        'leftPanelCollapseHeight' : PropTypes.number,
        'leftPanelCollapseWidth' : PropTypes.number,
        'leftPanelDefaultCollapsed' : PropTypes.bool
    };

    static defaultProps = {
        'minOpenHeight' : 300,
        'maxOpenHeight' : 800
    };

    constructor(props){
        super(props);
        _.bindAll(this, 'correctHiGlassTrackDimensions', 'renderLeftPanel');
        this.correctHiGlassTrackDimensions = _.debounce(this.correctHiGlassTrackDimensions, 100);
        this.higlassContainerRef = React.createRef();
    }

    componentDidUpdate(pastProps){
        const { width } = this.props;
        if (pastProps.width !== width){
            this.correctHiGlassTrackDimensions();
        }
    }

    /**
     * This is required because HiGlass doesn't always update all of own tracks' widths (always updates header, tho)
     */
    correctHiGlassTrackDimensions(){
        var internalHiGlassComponent = this.higlassContainerRef.current && this.higlassContainerRef.current.getHiGlassComponent();
        if (!internalHiGlassComponent) {
            console.warn('Internal HiGlass Component not accessible.');
            return;
        }
        setTimeout(HiGlassPlainContainer.correctTrackDimensions, 10, internalHiGlassComponent);
    }

    renderLeftPanel(leftPanelWidth, resetXOffset, collapsed, rightPanelHeight){
        const { renderLeftPanelPlaceholder, leftPanelCollapseHeight, higlassItem, minOpenHeight, maxOpenHeight } = this.props;
        if (collapsed){
            var useHeight = leftPanelCollapseHeight || rightPanelHeight || minOpenHeight;
            if (typeof renderLeftPanelPlaceholder === 'function'){
                return renderLeftPanelPlaceholder(leftPanelWidth, resetXOffset, collapsed, useHeight);
            } else {
                return (
                    <h5 className="placeholder-for-higlass text-center clickable mb-0 mt-0" style={{ 'lineHeight': useHeight + 'px', 'height': useHeight }} onClick={resetXOffset}
                        data-html data-place="right" data-tip="Open HiGlass Visualization for file(s)">
                        <i className="icon icon-fw fas icon-tv"/>
                    </h5>
                );
            }
        } else {
            return (
                <React.Fragment>
                    <EmbeddedHiglassActions context={higlassItem} showDescription={false} />
                    <HiGlassAjaxLoadContainer higlassItem={higlassItem} className={collapsed ? 'disabled' : null} height={Math.min(Math.max(rightPanelHeight - 16, minOpenHeight - 16), maxOpenHeight)} ref={this.higlassContainerRef} />
                </React.Fragment>
            );
        }
    }

    render(){
        const { mounted, minOpenHeight, leftPanelCollapseWidth, windowWidth } = this.props;

        // Don't render the HiGlass view if it isn't mounted yet or there is nothing to display.
        if (!mounted) {
            return (
                <div className="adjustable-divider-row text-center py-5">
                    <div className="text-center my-5">
                        <i className="icon icon-spin icon-circle-notch fas text-secondary icon-2x"/>
                    </div>
                </div>
            );
        }

        // Pass (almost) all props down so that re-renders are triggered of AdjustableDividerRow PureComponent
        const passProps = _.omit(this.props, 'higlassItem', 'minOpenHeight', 'maxOpenHeight', 'leftPanelCollapseWidth');
        const rgs = layout.responsiveGridState(windowWidth);
        const leftPanelDefaultWidth = rgs === 'xl' ? 400 : 300;

        return (
            <AdjustableDividerRow {...passProps} height={minOpenHeight} leftPanelClassName="expset-higlass-panel" leftPanelDefaultWidth={leftPanelDefaultWidth}
                leftPanelCollapseWidth={leftPanelCollapseWidth || 240} // TODO: Change to 240 after updating to HiGlass version w/ resize viewheader stuff fixed.
                renderLeftPanel={this.renderLeftPanel} rightPanelClassName="exp-table-container" onDrag={this.correctHiGlassTrackDimensions} />
        );
    }
}


class QCMetricsTable extends React.PureComponent {

    static qcSummaryItemTitleTooltipsByTitle(fileGroup) {
        const tooltipsByTitle = {};
        fileGroup.forEach(function({ title: qmsTitle, quality_metric_summary: { title_tooltip = null } = {} }){
            if (typeof tooltipsByTitle[qmsTitle] === "string") {
                return; // skip/continue; already found a tooltip_title for this qms title.
            }
            if (title_tooltip && typeof title_tooltip === "string"){
                tooltipsByTitle[qmsTitle] = title_tooltip;
            }
        });
        return tooltipsByTitle;
    }

    static renderForFileColValue(file) {
        const fileAtId = file && object.atIdFromObject(file);
        let fileTitleString;
        if (file.accession) {
            fileTitleString = file.accession;
        }
        if (!fileTitleString && fileAtId) {
            var idParts = _.filter(fileAtId.split('/'));
            if (idParts[1].slice(0, 5) === '4DNFI') {
                fileTitleString = idParts[1];
            }
        }
        if (!fileTitleString) {
            fileTitleString = file.uuid || fileAtId || 'N/A';
        }
        return (
            <React.Fragment>
                <div>{ Schemas.Term.toName("file_type_detailed", file.file_type_detailed, true) }</div>
                <a className="text-500 name-title" href={fileAtId}>
                    {fileTitleString}
                </a>
            </React.Fragment>);
    }

    static generateAlignedColumnHeaders(fileGroups){
        return fileGroups.map(function(fileGroup){
            const titleTooltipsByQMSTitle = QCMetricsTable.qcSummaryItemTitleTooltipsByTitle(fileGroup);
            const columnHeaders = [ // Static / present-for-each-table headers
                { columnClass: 'experiment', title: 'Experiment', initialWidth: 145, className: 'text-left' },
                { columnClass: 'file', className: 'double-height-block', title: 'For File', initialWidth: 100, render: QCMetricsTable.renderForFileColValue }
            ].concat(fileGroup[0].quality_metric.quality_metric_summary.map(function(qmsObj, qmsIndex){ // Dynamic Headers
                const { title, title_tooltip } = qmsObj;
                // title tooltip: if missing in the first item then try to get it from the first valid one in array
                return {
                    columnClass: 'file-detail',
                    title,
                    title_tooltip: title_tooltip || titleTooltipsByQMSTitle[title] || null,
                    initialWidth: 80,
                    render: function renderColHeaderValue(file, field, colIndex, fileEntryBlockProps) {
                        const qmsItem = file.quality_metric.quality_metric_summary[qmsIndex];
                        const { value, tooltip } = QCMetricFromSummary.formatByNumberType(qmsItem);
                        return <span className="d-inline-block" data-tip={tooltip}>{value}</span>;
                    }
                };
            }));

            // Add 'Link to Report' column, if any files w/ one. Else include blank one so columns align with any other stacked ones.
            const anyFilesWithMetricURL = _.any(fileGroup, function (f) {
                return f && f.quality_metric && f.quality_metric.url;
            });

            if (anyFilesWithMetricURL) {
                columnHeaders.push({ columnClass: 'file-detail', title: 'Report', initialWidth: 35, render: renderFileQCReportLinkButton });
                columnHeaders.push({ columnClass: 'file-detail', title: 'Details', initialWidth: 35, render: renderFileQCDetailLinkButton });
            } else {
                columnHeaders.push({ columnClass: 'file-detail', title: 'Details', initialWidth: 50, render: renderFileQCDetailLinkButton });
            }
            return columnHeaders;
        });
    }

    /**
     * commonFileUtil.groupFilesByQCSummaryTitles function is wrapped to allow
     * custom sorting by QC schema's qc_order and @type Atacseq or Chipseq specific QCS items
     */
    static groupFilesByQCSummaryTitles(filesWithMetrics, schemas) {
        let filesByTitles = commonFileUtil.groupFilesByQCSummaryTitles(filesWithMetrics);

        const comparerFunc = (filesA, filesB) => {
            const [fileA] = filesA; //assumption: 1st file's QC is adequate to define order
            const [fileB] = filesB; //assumption: 1st file's QC is adequate to define order

            let orderA, orderB;
            if (schemas) {
                const itemTypeA = schemaTransforms.getItemType(fileA.quality_metric);
                if (itemTypeA && schemas[itemTypeA]) {
                    const { qc_order } = schemas[itemTypeA];
                    if (typeof qc_order === 'number') {
                        orderA = qc_order;
                    }
                }
                const itemTypeB = schemaTransforms.getItemType(fileB.quality_metric);
                if (itemTypeB && schemas[itemTypeB]) {
                    const { qc_order } = schemas[itemTypeB];
                    if (typeof qc_order === 'number') {
                        orderB = qc_order;
                    }
                }
            }

            if (orderA && orderB && orderA !== orderB) {
                return orderA - orderB;
            }

            //custom comparison for @type Atacseq or Chipseq specific QCS items
            if (_.any(fileA.quality_metric.quality_metric_summary, (qcs) => qcs.title === 'Nonredundant Read Fraction (NRF)')) {
                return -1;
            } else if (_.any(fileB.quality_metric.quality_metric_summary, (qcs) => qcs.title === 'Nonredundant Read Fraction (NRF)')) {
                return 1;
            }

            return 0;
        };

        if (filesByTitles) {
            filesByTitles = filesByTitles.slice();
            filesByTitles.sort(comparerFunc);
        }

        return filesByTitles;
    }

    static defaultProps = {
        heading: (
            <h3 className="tab-section-title mt-12">
                <span>Quality Metrics</span>
            </h3>
        )
    };

    constructor(props){
        super(props);
        this.memoized = {
            filterFilesWithQCSummary: memoize(commonFileUtil.filterFilesWithQCSummary),
            groupFilesByQCSummaryTitles: memoize(QCMetricsTable.groupFilesByQCSummaryTitles),
            generateAlignedColumnHeaders: memoize(QCMetricsTable.generateAlignedColumnHeaders)
        };
    }

    render() {
        const { width, files, windowWidth, href, heading, schemas } = this.props;
        const filesWithMetrics = this.memoized.filterFilesWithQCSummary(files);
        const filesWithMetricsLen = filesWithMetrics.length;

        if (!filesWithMetrics || filesWithMetricsLen === 0) return null;

        const filesByTitles = this.memoized.groupFilesByQCSummaryTitles(filesWithMetrics, schemas);
        const columnHeadersForFileGroups = this.memoized.generateAlignedColumnHeaders(filesByTitles);
        const commonTableProps = {
            width, windowWidth, href,
            collapseLongLists: true, collapseLimit: 10, collapseShow: 7,
            analyticsImpressionOnMount: false, titleForFiles: "Processed File Metrics",
            showNotesColumns: 'never'
        };

        return (
            <div className="row">
                <div className="exp-table-container col-12">
                    { heading }
                    { filesByTitles.map(function(fileGroup, i){
                        return (
                            <ProcessedFilesStackedTable {...commonTableProps} key={i} files={fileGroup} columnHeaders={columnHeadersForFileGroups[i]} />
                        );
                    })}
                </div>
            </div>
        );
    }
}

class ProcessedFilesStackedTableSection extends React.PureComponent {

    /**
     * Searches the context for HiGlass static_content, and returns the HiGlassItem (except the viewconfig).
     *
     * @param {object} context - Object that has static_content.
     * @return {object} Returns the HiGlassItem in the context (or null if it doesn't)
     */
    static getHiglassItemFromProcessedFiles = memoize(function(context){
        if (!Array.isArray(context.static_content)){
            return null;
        }

        // Return the first appearance of a HiglassViewConfig Item located at "tab:processed-files"
        const higlassTab = _.find(context.static_content, function(section){
            return section.location === "tab:processed-files" && isHiglassViewConfigItem(section.content);
        });

        return (higlassTab ? higlassTab.content : null);
    });

    static tableProps(sectionProps){
        return _.extend(
            _.pick(sectionProps, 'files', 'windowWidth', 'href'),
            { 'collapseLimit' : 10, 'collapseShow' : 7, 'analyticsImpressionOnMount': true },
            SelectedFilesController.pick(sectionProps)
        );
    }

    static selectedFilesUniqueCount = memoize(uniqueFileCount);

    constructor(props){
        super(props);
        _.bindAll(this, 'renderTopRow', 'renderProcessedFilesTableAsRightPanel');
    }

    renderProcessedFilesTableAsRightPanel(rightPanelWidth, resetDivider, leftPanelCollapsed){
        return <ProcessedFilesStackedTable {...ProcessedFilesStackedTableSection.tableProps(this.props)} width={Math.max(rightPanelWidth, 320)} key="p-table" />;
    }

    renderTopRow(){
        const { mounted, width, context, windowWidth, selectedFiles } = this.props;

        const higlassItem = ProcessedFilesStackedTableSection.getHiglassItemFromProcessedFiles(context);

        if (higlassItem && object.itemUtil.atId(higlassItem)){
            // selectedFiles passed in to re-render panel if changes.
            return <HiGlassAdjustableWidthRow {...{ width, mounted, windowWidth, higlassItem, selectedFiles }} renderRightPanel={this.renderProcessedFilesTableAsRightPanel} />;
        } else {
            return <ProcessedFilesStackedTable {...ProcessedFilesStackedTableSection.tableProps(this.props)} width={width} key="p-table"/>;
        }
    }

    /**
     * Mostly clonned from ProcessedFilesStackedTable.defaultProps to render the table
     * compatible w/ processed file table
     */
    static expsNotAssociatedWithFileColumnHeaders = [
        {
            columnClass: 'experiment', className: 'text-left', title: 'Experiment', initialWidth: 180,
            render: function (exp) {
                const nameTitle = (exp && typeof exp.display_title === 'string' && exp.display_title.replace(' - ' + exp.accession, '')) || exp.accession;
                const experimentAtId = object.atIdFromObject(exp);
                const replicateNumbersExists = exp && exp.bio_rep_no && exp.tec_rep_no;

                return (
                    <StackedBlockName className={replicateNumbersExists ? "double-line" : ""}>
                        {replicateNumbersExists ? <div>Bio Rep <b>{exp.bio_rep_no}</b>, Tec Rep <b>{exp.tec_rep_no}</b></div> : <div />}
                        {experimentAtId ? <a href={experimentAtId} className="name-title text-500">{nameTitle}</a> : <div className="name-title">{nameTitle}</div>}
                    </StackedBlockName>
                );
            }
        },
        { columnClass: 'file', className: 'has-checkbox', title: 'File', initialWidth: 165 },
        { columnClass: 'file-detail', className: '', title: 'File Type', initialWidth: 135 },
        { columnClass: 'file-detail', className: '', title: 'File Size', initialWidth: 70 }
    ];

    render(){
        const { context, session, files, selectedFiles } = this.props;
        return (
            <div className="processed-files-table-section exp-table-section">
                <ProcessedFilesTableSectionHeader {...{ context, session, files, selectedFiles }} />
                {this.renderTopRow()}
                <ExperimentsWithoutFilesStackedTable {...this.props} />
                <QCMetricsTable {...this.props} />
            </div>
        );
    }
}

const ProcessedFilesTableSectionHeader = React.memo(function ProcessedFilesTableSectionHeader({ files, selectedFiles, context, session }){
    const selectedFilesUniqueCount = ProcessedFilesStackedTableSection.selectedFilesUniqueCount(selectedFiles);
    const filenamePrefix = (context.accession || context.display_title) + "_processed_files_";
    return (
        <h3 className="tab-section-title">
            <span>
                <span className="text-400">{ files.length }</span> Processed Files
            </span>
            { selectedFiles ? // Make sure data structure is present (even if empty)
                <div className="download-button-container pull-right" style={{ marginTop : -10 }}>
                    <SelectedFilesDownloadButton {...{ selectedFiles, filenamePrefix, context, session }} disabled={selectedFilesUniqueCount === 0}
                        id="expset-processed-files-download-files-btn" analyticsAddFilesToCart>
                        <i className="icon icon-download icon-fw fas mr-07 align-baseline"/>
                        <span className="d-none d-sm-inline">Download </span>
                        <span className="count-to-download-integer">{ selectedFilesUniqueCount }</span>
                        <span className="d-none d-sm-inline text-400"> Processed Files</span>
                    </SelectedFilesDownloadButton>
                </div>
                : null }
        </h3>
    );
});

const ExperimentsWithoutFilesStackedTable = React.memo(function ExperimentsWithoutFilesStackedTable(props) {
    const { context } = props;
    const expsNotAssociatedWithAnyFiles = _.filter(context.experiments_in_set, function (exp) {
        return !((exp.files && Array.isArray(exp.files) && exp.files.length > 0) || (exp.processed_files && Array.isArray(exp.processed_files) && exp.processed_files.length > 0));
    });

    if (expsNotAssociatedWithAnyFiles.length === 0) {
        return null;
    }

    const tableProps = { 'columnHeaders': ProcessedFilesStackedTableSection.expsNotAssociatedWithFileColumnHeaders };
    const expsWithReplicateExps = expFxn.combineWithReplicateNumbers(context.replicate_exps, expsNotAssociatedWithAnyFiles);
    const experimentBlock = expsWithReplicateExps.map((exp) => {
        const content = _.map(ProcessedFilesStackedTableSection.expsNotAssociatedWithFileColumnHeaders, function (col, idx) {
            if (col.render && typeof col.render === 'function') { return col.render(exp); }
            else {
                /**
                 * workaround: We surround div by React.Fragment to prevent 'Warning: React does not recognize the XX prop on a DOM element. If you intentionally want
                 * it to appear in the DOM as a custom attribute, spell it as lowercase $isactive instead.' error,
                 * since StackedBlockTable.js/StackedBlock component injects
                 * some props from parent element into 'div' element assuming it is a React component, in case it is not.
                 */
                return (
                    <React.Fragment>
                        <div className={"col-" + col.columnClass + " item detail-col" + idx} style={{ flex: '1 0 ' + col.initialWidth + 'px' }}>{'-'}</div>
                    </React.Fragment>
                );
            }
        });
        return (
            <StackedBlock columnClass="experiment" hideNameOnHover={false}
                key={exp.accession} label={
                    <StackedBlockNameLabel title={'Experiment'}
                        accession={exp.accession} subtitleVisible />
                }>
                {content}
            </StackedBlock>
        );
    });
    return (
        <div className="experiments-not-having-files">
            <div className="stacked-block-table-outer-container overflow-auto">
                <StackedBlockTable {..._.omit(props, 'children', 'files')} {...tableProps} className="expset-processed-files">
                    <StackedBlockList className="sets" collapseLongLists={false}>
                        {experimentBlock}
                    </StackedBlockList>
                </StackedBlockTable>
            </div>
        </div>
    );
});

class SupplementaryFilesOPFCollection extends React.PureComponent {

    static collectionStatus = function(files){
        const statuses = _.uniq(_.pluck(files, 'status'));
        const len = statuses.length;
        if (len === 1){
            return statuses[0];
        } else if (len > 1) {
            return statuses;
        }
        return null;
    }

    static defaultProps = {
        'defaultOpen' : false
    };

    constructor(props){
        super(props);
        this.toggleOpen = this.toggleOpen.bind(this);
        this.renderFilesTable = this.renderFilesTable.bind(this);
        // Usually have >1 SupplementaryFilesOPFCollection on page so we memoize at instance level not class level.
        this.collectionStatus = memoize(SupplementaryFilesOPFCollection.collectionStatus);

        this.state = {
            'open' : props.defaultOpen
        };
    }

    toggleOpen(e){
        this.setState(function(oldState){
            return { 'open' : !oldState.open };
        });
    }

    renderFilesTable(width, resetDividerFxn, leftPanelCollapsed){
        const { collection, href } = this.props;
        const passProps = _.extend({ width, href }, SelectedFilesController.pick(this.props));
        return (
            <ProcessedFilesStackedTable {...passProps} files={collection.files} collapseLongLists analyticsImpressionOnMount />
        );
    }

    renderStatusIndicator(){
        const { collection } = this.props;
        const { files, description } = collection;
        const status = this.collectionStatus(files);
        if (!status) return null;

        const outerClsName = "d-inline-block pull-right mr-12 ml-2 mt-1";
        if (typeof status === 'string'){
            const capitalizedStatus = Schemas.Term.toName("status", status);
            return (
                <div data-tip={"Status for all files in this collection is " + capitalizedStatus} className={outerClsName}>
                    <i className="item-status-indicator-dot mr-07" data-status={status} />
                    { capitalizedStatus }
                </div>
            );
        } else {
            const capitalizedStatuses = _.map(status, Schemas.Term.toName.bind(null, "status"));
            return (
                <div data-tip={"All files in collection have one of the following statuses - " + capitalizedStatuses.join(', ')} className={outerClsName}>
                    <span className="indicators-collection d-inline-block mr-05">
                        { _.map(status, function(s){ return <i className="item-status-indicator-dot mr-02" data-status={s} />; }) }
                    </span>
                    Multiple
                </div>
            );
        }
    }

    render(){
        const { collection, index, width, mounted, defaultOpen, windowWidth, href, selectedFiles } = this.props;
        const { files, higlass_view_config, description, title } = collection;
        const { open } = this.state;
        const qcMetricsHeading = (
            <h4 className="text-500 mt-2 mb-1">
                <span>Quality Metrics</span>
            </h4>
        );

        return (
            <div data-open={open} className="supplementary-files-section-part" key={title || 'collection-' + index}>
                { this.renderStatusIndicator() }
                <h4>
                    <span className="d-inline-block clickable" onClick={this.toggleOpen}>
                        <i className={"text-normal icon icon-fw fas icon-" + (open ? 'minus' : 'plus')} />
                        { title || "Collection " + index } <span className="text-normal text-300">({ files.length } file{files.length === 1 ? '' : 's'})</span>
                    </span>
                </h4>
                { description ?
                    <FlexibleDescriptionBox description={description} className="description"
                        fitTo="grid" expanded={open} windowWidth={windowWidth} />
                    : <div className="mb-15"/>
                }
                <Collapse in={open} mountOnEnter>
                    <div className="table-for-collection">
                        { higlass_view_config ?
                            <HiGlassAdjustableWidthRow higlassItem={higlass_view_config} windowWidth={windowWidth} mounted={mounted} width={width - 21}
                                renderRightPanel={this.renderFilesTable} selectedFiles={selectedFiles} leftPanelDefaultCollapsed={defaultOpen === false} />
                            : this.renderFilesTable(width - 21) }
                        <QCMetricsTable {...{ 'width': width - 20, windowWidth, href, files, 'heading': qcMetricsHeading }} />
                    </div>
                </Collapse>
            </div>
        );
    }
}


class SupplementaryReferenceFilesSection extends React.PureComponent {

    static defaultProps = {
        'defaultOpen' : true,
        'columnHeaders' : (function(){
            const colHeaders = ProcessedFilesStackedTable.defaultProps.columnHeaders.slice();
            colHeaders.push({
                columnClass: 'file-detail', title: 'Status', initialWidth: 30, field : "status",
                render : function(file, field, detailIndex, fileEntryBlockProps){
                    const capitalizedStatus = Schemas.Term.toName("status", file.status);
                    return <i className="item-status-indicator-dot" data-status={file.status} data-tip={capitalizedStatus} />;
                }
            });
            return colHeaders;
        })()
    };

    constructor(props){
        super(props);
        this.toggleOpen = this.toggleOpen.bind(this);
        this.state = { 'open' : props.defaultOpen };
    }

    toggleOpen(e){
        this.setState(function({ open  }){
            return { 'open' : !open };
        });
    }

    render(){
        const { files, width, href, columnHeaders } = this.props;
        const { open } = this.state;
        const filesLen = files.length;
        const passProps = _.extend({ width : width - 21, href, files }, SelectedFilesController.pick(this.props));
        return (
            <div data-open={open} className="reference-files-section supplementary-files-section-part">
                <h4 className="mb-15">
                    <span className="d-inline-block clickable" onClick={this.toggleOpen}>
                        <i className={"text-normal icon icon-fw fas icon-" + (open ? 'minus' : 'plus')} />
                        { filesLen + " Reference File" + (filesLen > 1 ? "s" : "") }
                    </span>
                </h4>
                <Collapse in={open} mountOnEnter>
                    <div className="table-for-collection">
                        <ProcessedFilesStackedTable {...passProps} files={files} columnHeaders={columnHeaders} />
                    </div>
                </Collapse>
            </div>
        );
    }
}


class SupplementaryFilesTabView extends React.PureComponent {

    static selectedFilesUniqueCount = memoize(uniqueFileCount);

    /** @returns {boolean} true if at least one file inside the collection is viewable */
    static checkOPFCollectionPermission({ files }){
        return _.any(files || [], function(file){
            return file && object.itemUtil.atId(file) && !file.error;
        });
    }

    /** @returns {boolean} true if at least one collection has at least one file inside the collection that is viewable */
    static checkOPFCollectionsPermissions(opfCollections){
        return _.any(opfCollections || [], SupplementaryFilesTabView.checkOPFCollectionPermission);
    }

    /**
     * Combines files from ExperimentSet.other_processed_files and ExperimentSet.experiments_in_set.other_processed_files.
     *
     * @param {ExperimentSet} context - JSON response from server for this endpoint/page depicting an ExperimentSet.
     * @returns {{ files: File[], title: string, type: string, description: string }[]} List of uniqued-by-title viewable collections.
     */
    static combinedOtherProcessedFiles = memoize(function(context){
        // Clone context
        let experiment_set = _.extend({}, context);
        // Add in Exp Bio & Tec Rep Nos, if available.
        if (Array.isArray(context.replicate_exps) && Array.isArray(context.experiments_in_set)) {
            experiment_set = combineExpsWithReplicateNumbersForExpSet(context);
        }

        // Clone -- so we don't modify props.context in place
        const collectionsFromExpSet = _.map(experiment_set.other_processed_files, function(collection){
            const { files : origFiles } = collection;
            const files = _.map(origFiles || [], function(file){
                return _.extend({ 'from_experiment_set' : experiment_set, 'from_experiment' : { 'from_experiment_set' : experiment_set, 'accession' : 'NONE' } }, file);
            });
            return _.extend({}, collection, { files });
        });

        const collectionsFromExpSetTitles = _.pluck(collectionsFromExpSet, 'title');

        // Files from collections from Experiments will be added to the arrays of files within these collections-from-expsets, w. new keys added if necessary.
        // We use foursight check to ensure titles are unique on back-end.
        const collectionsByTitle = _.object(_.zip(collectionsFromExpSetTitles, collectionsFromExpSet));

        // Add 'from_experiment' info to each collection file so it gets put into right 'experiment' row in StackedTable.
        // Also required for SelectedFilesController
        const allCollectionsFromExperiments = _.reduce(experiment_set.experiments_in_set || [], function(memo, exp){
            _.forEach(exp.other_processed_files || [], function(collection){
                const { files : origFiles } = collection;
                const files = _.map(origFiles || [], function(file){
                    return _.extend({ 'from_experiment' : _.extend({ 'from_experiment_set' : experiment_set }, exp), 'from_experiment_set' : experiment_set }, file);
                });
                memo.push(_.extend({}, collection, { files }));
            });
            return memo;
        }, []);

        _.forEach(allCollectionsFromExperiments, function(collection){
            const { title, files, description } = collection;
            if (collectionsByTitle[title]){ // Same title exists already from ExpSet.other_processed_files or another Experiment.other_processed_files.
                // Add in files unless is already present (== duplicate).
                _.forEach(files, function(f){
                    const duplicateExistingFile = _.find(collectionsByTitle[title].files, function(existFile){
                        return (object.itemUtil.atId(existFile) || 'a') === (object.itemUtil.atId(f) || 'b');
                    });
                    if (duplicateExistingFile){
                        console.error('Found existing/duplicate file in ExperimentSet other_processed_files of Experiment File ' + f['@id']);
                        // TODO send to analytics?
                    } else {
                        collectionsByTitle[title].files.push(f);
                    }
                });
                //clone description from exp's OPF if expset's OPF collection's missing
                collectionsByTitle[title].description = collectionsByTitle[title].description || description;
            } else {
                collectionsByTitle[title] = collection;
            }
        });

        // Ensure have view permissions
        return _.filter(_.values(collectionsByTitle), SupplementaryFilesTabView.checkOPFCollectionPermission);
    });

    static allReferenceFiles = memoize(function(context){
        // We keep track of duplicates and add a "from_experiment.accessions" property if any to help mark/ID
        // it as being present on multiple experiments.
        // Alternatively we might have been able to set "from_experiment.accession" (no "s") to "NONE" but this
        // would imply that is attached to ExperimentSet and not Experiment for metadata.tsv stuff later down the road
        // and present issues.
        // Also changing "from_experiment" to an array is a bit more of a pain than ideal...

        const referenceFilesByAtID = new Map(); // We use map to ensure we keep order of first encounter.

        _.forEach(context.experiments_in_set || [], function(experiment){
            _.forEach(experiment.reference_files || [], function(file){
                // Add "from_experiment" and "from_experiment_set" to allow to be properly distributed in stacked block table.
                // Also for metadata TSV downloads.
                const fileAtID = object.itemUtil.atId(file);
                const existingFile = referenceFilesByAtID.get(fileAtID);
                if (existingFile){
                    if (!Array.isArray(existingFile.from_experiment.from_multiple_accessions)){
                        existingFile.from_experiment.from_multiple_accessions = [ existingFile.from_experiment.accession ];
                    }
                    // We assume there's no duplicate reference files within a single experiment
                    existingFile.from_experiment.from_multiple_accessions.push(experiment.accession);
                    return;
                } else {
                    // Add "from_experiment" and "from_experiment_set" to allow to be properly distributed in stacked block table.
                    // Also for metadata TSV downloads.
                    const extendedFile = _.extend({}, file, {
                        'from_experiment' : _.extend({}, experiment, {
                            'from_experiment_set' : context
                        }),
                        'from_experiment_set' : context
                    });
                    referenceFilesByAtID.set(fileAtID, extendedFile);
                }
            });
        });

        return [ ...referenceFilesByAtID.values() ];
    });

    render(){
        const { context, session, width, mounted, windowWidth, href, selectedFiles } = this.props;
        const gridState = mounted && layout.responsiveGridState(windowWidth);
        const otherProcessedFileSetsCombined = SupplementaryFilesTabView.combinedOtherProcessedFiles(context);
        const otherProcessedFileSetsCombinedLen = otherProcessedFileSetsCombined.length;

        const referenceFiles = SupplementaryFilesTabView.allReferenceFiles(context);
        const referenceFilesLen = referenceFiles.length;

        const titleDetailString = (
            (referenceFilesLen > 0 ? (referenceFilesLen + " Reference File" + (referenceFilesLen > 1 ? "s" : "")) : "") +
            (otherProcessedFileSetsCombinedLen > 0 && referenceFilesLen > 0 ? " and " : '') +
            (otherProcessedFileSetsCombinedLen > 0 ? (otherProcessedFileSetsCombinedLen + " Processed Files Collection" + (otherProcessedFileSetsCombinedLen > 1 ? "s" : "")) : '')
        );

        const selectedFilesUniqueCount = SupplementaryFilesTabView.selectedFilesUniqueCount(selectedFiles);

        const commonProps = { context, width, mounted, windowWidth, href, ...SelectedFilesController.pick(this.props) };

        const filenamePrefix = (context.accession || context.display_title) + "_supp_files_";
        // TODO: Metadata.tsv stuff needs to be setup before we can select files from other_processed_files & reference_files
        //const commonProps = _.extend({ context, width, mounted, windowWidth }, SelectedFilesController.pick(this.props));

        return (
            <div className="processed-files-table-section">
                <h3 className="tab-section-title">
                    Supplementary Files
                    { titleDetailString.length > 0 ? <span className="small">&nbsp;&nbsp; &bull; {titleDetailString}</span> : null }
                    {selectedFiles ? // Make sure data structure is present (even if empty)
                        <div className="download-button-container pull-right" style={{ marginTop: -10 }}>
                            <SelectedFilesDownloadButton {...{ selectedFiles, filenamePrefix, context, session }} disabled={selectedFilesUniqueCount === 0}
                                id="expset-raw-files-download-files-btn" analyticsAddFilesToCart>
                                <i className="icon icon-download fas icon-fw mr-07 align-baseline" />
                                <span className="d-none d-sm-inline">Download </span>
                                <span className="count-to-download-integer">{selectedFilesUniqueCount}</span>
                                <span className="d-none d-sm-inline text-400"> Supplementary Files</span>
                            </SelectedFilesDownloadButton>
                        </div>
                        : null}
                </h3>
                <hr className="tab-section-title-horiz-divider"/>
                { referenceFilesLen > 0 ?
                    <SupplementaryReferenceFilesSection {...commonProps} files={referenceFiles} />
                    : null }
                { _.map(otherProcessedFileSetsCombined, function(collection, index, all){
                    const defaultOpen = (gridState === 'sm' || gridState === 'xs' || !gridState) ? false : ((all.length < 4) || (index < 2));
                    return <SupplementaryFilesOPFCollection {..._.extend({ collection, index, defaultOpen }, commonProps)} key={index} />;
                }) }
            </div>
        );
    }
}
