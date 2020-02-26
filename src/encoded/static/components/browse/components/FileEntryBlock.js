'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import memoize from 'memoize-one';
import _ from 'underscore';

import { StackedBlockNameLabel } from '@hms-dbmi-bgm/shared-portal-components/es/components/browse/components/StackedBlockTable';
import { IndeterminateCheckbox } from '@hms-dbmi-bgm/shared-portal-components/es/components/forms/components/IndeterminateCheckbox';
import { object, typedefs, analytics } from '@hms-dbmi-bgm/shared-portal-components/es/components/util';
import { expFxn, Schemas } from './../../util';

// eslint-disable-next-line no-unused-vars
const { File } = typedefs;

/**
 * These components are meant to be used within a StackedBlockTable
 * See file-tables.js for more info/context.
 *
 * These depend on 4DN-specific data structures, e.g. ExpSet->Exp->File|ProcessedFile
 * and thus are located here and not in shared repo.
 * @module
 */


/** Use... somewhere */
/**
 * If we have a SelectedFilesController up the parent/ancestor chain that feeds us selectFile, selectedFiles,
 * and unselectFile, this is the handler to use for checkbox stacked blocks. Use from within a class method of a class
 * which accepts these selectFile & etc props.
 *
 * @param {string|string[]} accessionTripleString - String or list of strings which represented 3 accessions (ExpSet, Exp, File) delimited by a tilde (~).
 * @param {File|File[]} fileObj - File Item JSON
 * @param {{ selectedFiles : Object.<string, File>, selectFile: function, unselectFile: function }} fileSelectionProps - File selection props passed in from SelectedFilesController.
 * @returns {void} - Nothing.
 */
export function handleFileCheckboxChangeFxn(accessionTripleString, fileObj, fileSelectionProps){
    const { selectedFiles, selectFile, unselectFile } = fileSelectionProps;
    let willSelect;
    let isMultiples;

    if (!selectedFiles || !selectFile || !unselectFile) return null;

    if (Array.isArray(accessionTripleString)){
        isMultiples = true;
        willSelect = typeof selectedFiles[accessionTripleString[0]] === 'undefined';
    } else {
        isMultiples = false;
        willSelect = typeof selectedFiles[accessionTripleString] === 'undefined';
    }

    if (willSelect){
        if (isMultiples){
            selectFile(_.zip(accessionTripleString, fileObj));
        } else {
            selectFile(accessionTripleString, fileObj);
        }
    } else {
        unselectFile(accessionTripleString);
    }
}


function SingleFileCheckbox(props){
    const { file, selectedFiles, handleFileCheckboxChange } = props;
    if (!selectedFiles || !handleFileCheckboxChange || !SingleFileCheckbox.hasCheckbox(file)){
        return null;
    }
    const isChecked = SingleFileCheckbox.isChecked(file, selectedFiles);
    const accessionTriple = expFxn.fileToAccessionTriple(file, true);
    return (
        <input type="checkbox" checked={isChecked} name="file-checkbox" id={'checkbox-for-' + accessionTriple}
            className="file-entry-table-checkbox" data-select-files={[accessionTriple]}
            onChange={handleFileCheckboxChange.bind(handleFileCheckboxChange, accessionTriple, file)} />
    );
}
SingleFileCheckbox.hasCheckbox = function(file){
    if (!file || !file.accession) return false;
    // Needed to generate accessionTriple (ExpSet,Exp,File)
    if (!file.from_experiment || !file.from_experiment.from_experiment_set) return false;
    if (!file.from_experiment.accession || !file.from_experiment.from_experiment_set.accession) return false;
    return true;
};
SingleFileCheckbox.isChecked = function(file, selectedFiles){
    if (!file || !file.accession || !selectedFiles) return null;
    var accessionTriple = expFxn.fileToAccessionTriple(file, true);
    // We must return a bool here to be fed into the `checked` attribute of a checkbox.
    return !!(selectedFiles[accessionTriple]);
};


/** Used for a single file row with or without checkbox for that single file */
export class FileEntryBlock extends React.PureComponent {

    static propTypes = {
        'selectedFiles' : PropTypes.object,
        'handleFileCheckboxChange' : PropTypes.func,
        'excludeCheckbox' : PropTypes.bool,
        'file' : PropTypes.object,
        'columnHeaders' : PropTypes.arrayOf(PropTypes.object)
    };

    static defaultProps = {
        'excludeCheckbox' : false,
        'label' : <StackedBlockNameLabel title="File" />,
        'hideNameOnHover' : false,
        'keepLabelOnHover' : true
    };

    constructor(props){
        super(props);
        this.filledFileRow = this.filledFileRow.bind(this);
        this.onNameClick = this.onNameClick.bind(this);
        this.renderName = this.renderName.bind(this);
    }

    /**
     * Returns a row (list) of column values for `"file-detail"` columnClass columnHeaders.
     * Contains a number of hard-coded rules for certain titles:
     */
    filledFileRow(){
        const { columnHeaders, className, colWidthStyles, file } = this.props;
        const fileAtId = object.itemUtil.atId(file);
        const row = []; // Return val.
        const cols = _.filter(columnHeaders, function(col){ return col.columnClass === 'file-detail'; });
        const baseClassName = (className || '') + " col-file-detail item";

        _.forEach(cols, (col, index)=>{

            const colClassName = baseClassName + ' col-' + col.columnClass + ' detail-col-' + index;
            const colStyle = colWidthStyles ? colWidthStyles[col.field || col.title || col.columnClass] : null;

            if (typeof col.render === 'function'){
                row.push(
                    <div key={col.field || index} className={colClassName} style={colStyle}>
                        { col.render(file, col.field, index, this.props) }
                    </div>
                );
                return;
            }

            if (!fileAtId) {
                // Empty block to take up space/width needed.
                row.push(<div key={"file-detail-empty-" + index} className={colClassName} style={colStyle}></div>);
                return;
            }

            if (typeof col.field === 'string'){
                // Grab value out of file.
                let val = object.getNestedProperty(file, col.field, true);
                val = (val && Schemas.Term.toName(col.field, val, true)) || '-';
                row.push(<div key={col.field} className={colClassName} style={colStyle}>{ val }</div>);
                return;
            }
        });

        return row;
    }

    onNameClick(e){
        const { file } = this.props;
        analytics.productClick(file);
    }

    renderNameInnerTitle(){
        const { file, columnHeaders } = this.props;
        const colForFile = _.findWhere(columnHeaders || [], { 'columnClass' : 'file' }) || null;
        const fileAtId = file && object.atIdFromObject(file);
        const fileError = (file && file.error) || false;
        let fileTitleString;

        if (fileError) {
            return <div key="name-title" className="name-title inline-block"><em>{ fileError }</em></div>;
        }

        if (!file || !fileAtId) {
            return <div key="name-title" className="name-title inline-block"><em>No file(s) or view permissions.</em></div>;
        }

        if (typeof colForFile.render === 'function') {
            var renderedName = colForFile.render(file, colForFile.field || null, 0, this.props);
            if (renderedName) return (
                <div key="name-title" className="name-title inline-block" onClick={this.onNameClick}>
                    { renderedName }
                </div>
            );
        }

        if (!fileTitleString && file.accession) {
            fileTitleString = file.accession;
        }
        if (!fileTitleString && fileAtId) {
            var idParts = _.filter(fileAtId.split('/'));
            if (idParts[1].slice(0,5) === '4DNFI'){
                fileTitleString = idParts[1];
            }
        }
        if (!fileTitleString) {
            fileTitleString = file.uuid || fileAtId || 'N/A';
        }

        return (
            <a className="title-of-file mono-text name-title" href={fileAtId} onClick={this.onNameClick}>
                { fileTitleString }
            </a>
        );
    }


    renderName(){
        const { file, colWidthStyles, label, excludeCheckbox, selectedFiles } = this.props;
        const classList = ['name', 'col-file'];
        if (file && file.accession) classList.push('mono-text');
        if (!excludeCheckbox && selectedFiles && SingleFileCheckbox.hasCheckbox(file)){
            classList.push('has-checkbox');
        }
        return (
            <div key="file-entry-name-block" className={classList.join(' ')}
                style={colWidthStyles ? colWidthStyles.file : null}>
                { label }
                { !excludeCheckbox ? <SingleFileCheckbox {...this.props} /> : null }
                { this.renderNameInnerTitle() }
            </div>
        );
    }

    render(){
        const { hideNameOnHover, keepLabelOnHover, isSingleItem, stripe, stackDepth } = this.props;
        const classList = ['s-block', 'file', 'stack-depth-' + stackDepth];

        if (hideNameOnHover)    classList.push('hide-name-on-block-hover');
        if (keepLabelOnHover)   classList.push('keep-label-on-name-hover');
        if (isSingleItem)       classList.push('single-item');
        if (typeof stripe !== 'undefined' && stripe !== null){
            classList.push((stripe === true || stripe === 'even') ? ' even' : ' odd');
        }
        return (
            <div key="file-s-block" className={classList.join(' ')}>
                { this.renderName() }
                { this.filledFileRow() }
            </div>
        );
    }
}

export class ExperimentEntryBlock extends React.PureComponent {

    static propTypes = {
        'selectedFiles' : PropTypes.object,
        'handleFileCheckboxChange' : PropTypes.func,
        'excludeCheckbox' : PropTypes.bool,
        'experiments' : PropTypes.object,
        'columnHeaders' : PropTypes.arrayOf(PropTypes.object)
    };

    static defaultProps = {
        'excludeCheckbox' : false,
        'label' : <StackedBlockNameLabel title="" />,
        'hideNameOnHover' : false,
        'keepLabelOnHover' : true
    };

    constructor(props){
        super(props);
        this.filledFileRow = this.filledFileRow.bind(this);
        this.renderName = this.renderName.bind(this);
    }

    /**
     * Returns a row (list) of column values for `"file-detail"` columnClass columnHeaders.
     * Contains a number of hard-coded rules for certain titles:
     */
    filledFileRow(){
        const { columnHeaders, className, colWidthStyles,file } = this.props;
        const row = []; // Return val.
        const cols = _.filter(columnHeaders, function(col){ return col.columnClass === 'file-detail'; });
        const baseClassName = (className || '') + " col-file-detail item";

        _.forEach(cols, (col, index)=>{
            const colClassName = baseClassName + ' col-' + col.columnClass + ' detail-col-' + index;
            const colStyle = colWidthStyles ? colWidthStyles[col.field || col.title || col.columnClass] : null;

            if (typeof col.render === 'function') {
                row.push(
                    <div key={col.field || index} className={colClassName} style={colStyle}>
                        {col.render(file, col.field, index, this.props)}
                    </div>
                );
                return;
            }

            if (typeof col.field === 'string'){
                // Grab value out of file.
                let val = object.getNestedProperty(file, col.field, true);
                val = (val && Schemas.Term.toName(col.field, val, true)) || '-';
                row.push(<div key={col.field} className={colClassName} style={colStyle}>{ val }</div>);
                return;
            }
        });
        return row;
    }

    renderNameInnerTitle(){
        const { file, columnHeaders } = this.props;
        const colForFile = _.findWhere(columnHeaders || [], { 'columnClass' : 'file' }) || null;
        const fileAtId = file && object.atIdFromObject(file);
        const fileError = (file && file.error) || false;
        let fileTitleString;

        if (fileError) {
            return <div key="name-title" className="name-title inline-block"><em>{ fileError }</em></div>;
        }

        if (!file || !fileAtId) {
            return <div key="name-title" className="name-title inline-block"><em>No file(s) or view permissions.</em></div>;
        }

        if (typeof colForFile.render === 'function') {
            var renderedName = colForFile.render(file, colForFile.field || null, 0, this.props);
            if (renderedName) return <div key="name-title" className="name-title inline-block">{ renderedName }</div>;
        }

        if (!fileTitleString && file.accession) {
            fileTitleString = file.accession;
        }
        if (!fileTitleString && fileAtId) {
            var idParts = _.filter(fileAtId.split('/'));
            if (idParts[1].slice(0,5) === '4DNFI'){
                fileTitleString = idParts[1];
            }
        }
        if (!fileTitleString) {
            fileTitleString = displayTitle || displayTitle || 'N/A';
        }

        return <a className="title-of-file mono-text name-title" href={fileAtId}>{ fileTitleString }</a>;
    }


    renderName(){
        const { file, colWidthStyles, label, excludeCheckbox, selectedFiles } = this.props;
        const classList = ['name', 'col-file'];
        if (file && file.accession) classList.push('mono-text');
        if (!excludeCheckbox && selectedFiles && SingleFileCheckbox.hasCheckbox(file)){
            classList.push('has-checkbox');
        }
        return (
            <div key="file-entry-name-block" className={classList.join(' ')}
                style={colWidthStyles ? colWidthStyles.file : null}>
                { label }
                { !excludeCheckbox ? <SingleFileCheckbox {...this.props} /> : null }
                { this.renderNameInnerTitle() }
            </div>
        );
    }

    render(){
        const { hideNameOnHover, keepLabelOnHover, isSingleItem, stripe, stackDepth } = this.props;
        const classList = ['s-block', 'file', 'stack-depth-' + stackDepth];

        if (hideNameOnHover)    classList.push('hide-name-on-block-hover');
        if (keepLabelOnHover)   classList.push('keep-label-on-name-hover');
        if (isSingleItem)       classList.push('single-item');
        if (typeof stripe !== 'undefined' && stripe !== null){
            classList.push((stripe === true || stripe === 'even') ? ' even' : ' odd');
        }
        return (
            <div key="file-s-block" className={classList.join(' ')}>
                { this.renderName() }
                { this.filledFileRow() }
            </div>
        );
    }
}

/** Renders out a checkbox which controls selected state of multiple files */
class MultipleFileCheckbox extends React.PureComponent {

    static hasCheckBox(files){
        if (!Array.isArray(files) || files.length === 0) return false;
        return _.every(files, function(file){ return SingleFileCheckbox.hasCheckbox(file); });
    }

    static isChecked(accessionTriples, selectedFiles){
        for (var i = 0; i < accessionTriples.length; i++){
            if (typeof selectedFiles[accessionTriples[i]] === 'undefined') return false;
        }
        return true;
    }

    static isIndeterminate(accessionTriples, selectedFiles){
        for (var i = 0; i < accessionTriples.length; i++){
            if (typeof selectedFiles[accessionTriples[i]] !== 'undefined') return true;
        }
        return false;
    }

    static propTypes = {
        'selectedFiles' : PropTypes.object,
        'onChange' : PropTypes.func,
        'files' : PropTypes.array
    };

    static defaultProps = {
        'className' : 'checkbox-for-multiple-files',
        'name' : "file-checkbox"
    };

    constructor(props){
        super(props);
        this.isChecked = memoize(MultipleFileCheckbox.isChecked);
        this.isIndeterminate = memoize(MultipleFileCheckbox.isIndeterminate);
    }

    render(){
        const { files, selectedFiles, onChange } = this.props;
        const filesCount = (Array.isArray(files) && files.length) || 0;

        if (filesCount === 0 || !onChange || !selectedFiles || !MultipleFileCheckbox.hasCheckBox(files)){
            return null;
        }

        const accessionTriples = expFxn.filesToAccessionTriples(files, true);
        const checked = this.isChecked(accessionTriples, selectedFiles);
        const indeterminate = !checked && this.isIndeterminate(accessionTriples, selectedFiles);
        const lineHeight = (filesCount * 35 - 14) + 'px';

        return (
            <div className="multiple-files-checkbox-wrapper inline-block" data-files-count={filesCount} style={{ lineHeight }}>
                <IndeterminateCheckbox {...{ indeterminate, checked }} id={'checkbox-for-' + accessionTriples.join('_')}
                    data-select-files={accessionTriples} {..._.omit(this.props, 'files', 'selectedFiles')} />
            </div>
        );
    }
}


/**
 * Used as a row for multiple child files.
 * Renders out a multiple file checkbox (optional) + multiple FileEntryBlock child rows.
 * Can customize which rows - this or children - have checkboxes.
 */
export class FilePairBlock extends React.PureComponent {

    static isSingleItem(isSingleItemProp, files){
        return typeof isSingleItemProp === 'boolean' ? isSingleItemProp : files.length < 2 ? true : false;
    }

    static propTypes = {
        'handleFileCheckboxChange' : PropTypes.func,
        'isSingleItem' : PropTypes.bool,
        'selectedFiles' : PropTypes.object,
        'files' : PropTypes.arrayOf(PropTypes.object),
        'excludeChildrenCheckboxes' : PropTypes.bool,
        'excludeOwnCheckbox' : PropTypes.bool
    };

    static defaultProps = {
        'excludeChildrenCheckboxes' : true,
        'excludeOwnCheckbox' : false
    };

    constructor(props){
        super(props);
        this.nameColumn = this.nameColumn.bind(this);
        this.onCheckboxChange = this.onCheckboxChange.bind(this);
        this.isSingleItem = memoize(FilePairBlock.isSingleItem);
    }

    onCheckboxChange(e){
        const { files, handleFileCheckboxChange } = this.props;
        const accessionTriples = expFxn.filesToAccessionTriples(files, true);
        handleFileCheckboxChange(accessionTriples, files);
    }

    nameColumn(){
        const { label, colWidthStyles, name, files, selectedFiles, excludeOwnCheckbox } = this.props;
        /*
        var labelToShow = null;
        if (typeof label === 'string'){
            labelToShow = <StackedBlock.Name.Label title="Pair" subtitle={label} />;
        } else if (typeof label === 'object' && label){
            labelToShow = <StackedBlock.Name.Label {...label} />;
        }
        */
        return (
            <div className="name col-file-group" style={colWidthStyles ? _.clone(colWidthStyles['file-group']) : null}>
                { label }
                <div className="name-title" key="name-title">
                    { !excludeOwnCheckbox ?
                        <MultipleFileCheckbox onChange={this.onCheckboxChange} {...{ files, selectedFiles }} />
                        : null }
                    { name }
                </div>
            </div>
        );
    }

    render(){
        const { files, columnHeaders, colWidthStyles, isSingleItem, excludeChildrenCheckboxes, hideNameOnHover, stackDepth } = this.props;
        const isReallySingleItem = this.isSingleItem(isSingleItem, files);
        const cls = (
            "s-block file-group keep-label-on-name-hover" +
            (hideNameOnHover ? ' hide-name-on-block-hover' : '') +
            " stack-depth-" + stackDepth
        );

        let childBlocks;

        if (!Array.isArray(files) || files.length === 0){
            // Blank placeholder thingy (?) todo: test
            childBlocks = <FileEntryBlock file={null} {...{ columnHeaders, colWidthStyles }} />;
        } else {
            childBlocks = _.map(files, (file) =>
                <FileEntryBlock key={object.atIdFromObject(file)}
                    {..._.omit(this.props, 'files', 'file', 'isSingleItem', 'className', 'type', 'excludeChildrenCheckboxes', 'excludeOwnCheckbox', 'name', 'label')}
                    file={file} stackDepth={stackDepth + 1}
                    className={null}
                    isSingleItem={isReallySingleItem}
                    excludeCheckbox={excludeChildrenCheckboxes} // May be excluded as this block has own checkbox
                    type="paired-end" />
            );
        }

        return (
            <div className={cls}>
                { this.nameColumn() }
                <div className={"files s-block-list stack-depth-" + stackDepth}>{ childBlocks }</div>
            </div>
        );
    }
}

/**
 * Used by `visibleTitle` functions/renderers.
 * @see file-tables.js / renderFileHeaderWithCheckbox()
 * @see file-tables.js / ProcessedFilesTable.defaultProps.columnHeaders
 * @see file-tables.js / RawFilesStackedTable.builtInHeaders()
 */
export class FileHeaderWithCheckbox extends React.PureComponent {

    static filesWithViewPermission(allFiles){
        return _.filter(allFiles, object.itemUtil.atId);
    }

    constructor(props){
        super(props);
        this.onChange = this.onChange.bind(this);
        this.isChecked = memoize(MultipleFileCheckbox.isChecked);
        this.isIndeterminate = memoize(MultipleFileCheckbox.isIndeterminate);
        this.filesWithViewPermission = memoize(FileHeaderWithCheckbox.filesWithViewPermission);
    }

    onChange(){
        const { allFiles, handleFileCheckboxChange } = this.props;
        const files = this.filesWithViewPermission(allFiles);
        const accessionTriples = expFxn.filesToAccessionTriples(files, true);
        handleFileCheckboxChange(accessionTriples, files);
    }

    render(){
        const { allFiles, selectedFiles, children } = this.props;
        const files = this.filesWithViewPermission(allFiles);
        const accessionTriples = expFxn.filesToAccessionTriples(files, true);
        const checked = this.isChecked(accessionTriples, selectedFiles);
        const indeterminate = !checked && this.isIndeterminate(accessionTriples, selectedFiles);

        return (
            <React.Fragment>
                <IndeterminateCheckbox {..._.omit(this.props, 'allFiles', 'selectedFiles', 'children')} {...{ indeterminate, checked }}
                    data-select-files={accessionTriples} onChange={this.onChange} className="file-header-select-checkbox" />
                { children }
            </React.Fragment>
        );
    }
}
