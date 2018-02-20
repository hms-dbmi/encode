// Render a simple static help page

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'underscore';
import { content_views } from '../globals';
import StaticPage, { StaticEntry } from './StaticPage';
import { Button } from 'react-bootstrap';

/**
 * Extends StaticEntry with 'replacePlaceholder' function which renders the pre-defined SlideCarousel component.
 * Emulate this approach for other placeholders (?).
 */
class HelpEntry extends StaticEntry {

    static defaultProps = {
        'section'   : null,
        'content'   : null,
        'entryType' : 'help',
        'className' : 'text-justified'
    }

    replacePlaceholder(placeholderString){
        if (placeholderString === '<SlideCarousel/>'){
            return (<SlideCarousel />);
        }
        return placeholderString;
    }
}


export default class HelpPage extends StaticPage {

    entryRenderFxn(sectionName, content, context){
        return (<HelpEntry key={sectionName} sectionName={sectionName} content={content} context={context} />);
    }

}

content_views.register(HelpPage, 'HelpPage');



class SlideCarousel extends React.Component {

    constructor(props){
        super(props);
        this.handleForward = this.handleForward.bind(this);
        this.handleBackward = this.handleBackward.bind(this);
        this.render = this.render.bind(this);
        this.state = {
            index: 0,
            slideTitles: [
                "Slide01.png", "Slide02.png", "Slide03.png", "Slide04.png",
                "Slide05.png", "Slide06.png", "Slide07.png", "Slide08.png",
                "Slide09.png", "Slide10.png", "Slide11.png", "Slide12.png",
                "Slide13.png", "Slide14.png", "Slide15.png", "Slide16.png"
            ]
        };
    }

    handleForward(){
        var nextIdx;
        if (this.state.index + 1 < this.state.slideTitles.length) {
            nextIdx = this.state.index + 1;
        }else{
            nextIdx = this.state.index;
        }
        this.setState({
            index: nextIdx
        });
    }

    handleBackward(){
        var nextIdx;
        if (this.state.index - 1 >= 0) {
            nextIdx = this.state.index - 1;
        }else{
            nextIdx = this.state.index;
        }
        this.setState({
            index: nextIdx
        });
    }

    render() {
        var slideName = "/static/img/Metadata_structure_slides/" + this.state.slideTitles[this.state.index];
        var slide = <img width={720} height={540} alt="720x540" src={slideName}></img>;
        return(
            <div className="slide-display">
                <div className="slide-controls">
                    <Button disabled={this.state.index == 0} bsSize="xsmall" onClick={this.handleBackward}>Previous</Button>
                    <Button disabled={this.state.index == this.state.slideTitles.length-1} bsSize="xsmall" onClick={this.handleForward}>Next</Button>
                </div>
                {slide}
            </div>
        );
    }

}