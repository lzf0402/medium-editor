(function () {
    'use strict';

    var keyboardPasteTimeStamp = 0,
        pasteBinDefaultContent = '%ME_PASTEBIN%',
        lastRange = null,
        stopProp = function (event) {
            event.stopPropagation();
        };

    /*jslint regexp: true*/
    /*
        jslint does not allow character negation, because the negation
        will not match any unicode characters. In the regexes in this
        block, negation is used specifically to match the end of an html
        tag, and in fact unicode characters *should* be allowed.
    */
    function createReplacements() {
        return [
            // replace two bogus tags that begin pastes from google docs
            [new RegExp(/<[^>]*docs-internal-guid[^>]*>/gi), ''],
            [new RegExp(/<\/b>(<br[^>]*>)?$/gi), ''],

             // un-html spaces and newlines inserted by OS X
            [new RegExp(/<span class="Apple-converted-space">\s+<\/span>/g), ' '],
            [new RegExp(/<br class="Apple-interchange-newline">/g), '<br>'],

            // replace google docs italics+bold with a span to be replaced once the html is inserted
            [new RegExp(/<span[^>]*(font-style:italic;font-weight:bold|font-weight:bold;font-style:italic)[^>]*>/gi), '<span class="replace-with italic bold">'],

            // replace google docs italics with a span to be replaced once the html is inserted
            [new RegExp(/<span[^>]*font-style:italic[^>]*>/gi), '<span class="replace-with italic">'],

            //[replace google docs bolds with a span to be replaced once the html is inserted
            [new RegExp(/<span[^>]*font-weight:bold[^>]*>/gi), '<span class="replace-with bold">'],

             // replace manually entered b/i/a tags with real ones
            [new RegExp(/&lt;(\/?)(i|b|a)&gt;/gi), '<$1$2>'],

             // replace manually a tags with real ones, converting smart-quotes from google docs
            [new RegExp(/&lt;a(?:(?!href).)+href=(?:&quot;|&rdquo;|&ldquo;|"|“|”)(((?!&quot;|&rdquo;|&ldquo;|"|“|”).)*)(?:&quot;|&rdquo;|&ldquo;|"|“|”)(?:(?!&gt;).)*&gt;/gi), '<a href="$1">'],

            // Newlines between paragraphs in html have no syntactic value,
            // but then have a tendency to accidentally become additional paragraphs down the line
            [new RegExp(/<\/p>\n+/gi), '</p>'],
            [new RegExp(/\n+<p/gi), '<p'],

            // Microsoft Word makes these odd tags, like <o:p></o:p>
            [new RegExp(/<\/?o:[a-z]*>/gi), ''],

            // cleanup comments added by Chrome when pasting html
            ['<!--EndFragment-->', ''],
            ['<!--StartFragment-->', '']
        ];
    }
    /*jslint regexp: false*/

    var PasteHandler = MediumEditor.Extension.extend({
        /* Paste Options */

        /* forcePlainText: [boolean]
         * Forces pasting as plain text.
         */
        forcePlainText: true,

        /* cleanPastedHTML: [boolean]
         * cleans pasted content from different sources, like google docs etc.
         */
        cleanPastedHTML: false,

        /* preCleanReplacements: [Array]
         * custom pairs (2 element arrays) of RegExp and replacement text to use during past when
         * __forcePlainText__ or __cleanPastedHTML__ are `true` OR when calling `cleanPaste(text)` helper method.
         * These replacements are executed before any medium editor defined replacements.
         */
        preCleanReplacements: [],

        /* cleanReplacements: [Array]
         * custom pairs (2 element arrays) of RegExp and replacement text to use during paste when
         * __forcePlainText__ or __cleanPastedHTML__ are `true` OR when calling `cleanPaste(text)` helper method.
         * These replacements are executed after any medium editor defined replacements.
         */
        cleanReplacements: [],

        /* cleanAttrs:: [Array]
         * list of element attributes to remove during paste when __cleanPastedHTML__ is `true` or when
         * calling `cleanPaste(text)` or `pasteHTML(html, options)` helper methods.
         */
        cleanAttrs: ['class', 'style', 'dir'],

        /* cleanTags: [Array]
         * list of element tag names to remove during paste when __cleanPastedHTML__ is `true` or when
         * calling `cleanPaste(text)` or `pasteHTML(html, options)` helper methods.
         */
        cleanTags: ['meta'],

        init: function () {
            MediumEditor.Extension.prototype.init.apply(this, arguments);

            if (this.forcePlainText || this.cleanPastedHTML) {
                this.subscribe('editableKeydown', this.handleKeydown.bind(this));
                // this.subscribe('editablePaste', this.handlePaste.bind(this));
            }
        },

        handleKeydown: function (event) {
            // if it's not Ctrl+V, do nothing
            if (!(MediumEditor.util.isKey(event, MediumEditor.util.keyCode.V) && MediumEditor.util.isMetaCtrlKey(event))) {
                return;
            }

            event.stopImmediatePropagation();

            keyboardPasteTimeStamp = new Date().getTime();

            this.removePasteBin();
            this.createPasteBin();
        },

        handlePaste: function (event) {
            var clipboardTimer, clipboardContent, clipboardDelay,
                isKeyBoardPaste, plainTextMode,
                paragraphs, content,
                html = '',
                that = this,
                p;

            clipboardTimer = new Date().getTime();
            clipboardContent = this.getClipboardContent(event);
            clipboardDelay = new Date().getTime() - clipboardTimer;

            isKeyBoardPaste = (new Date().getTime() - keyboardPasteTimeStamp - clipboardDelay) < 1000;

            plainTextMode = !this.cleanPastedHTML || this.forcePlainText;

            if (event.isDefaultPrevented) {
                this.removePasteBin();
                return;
            }

            // Not a keyboard paste prevent default paste and try to grab the clipboard contents using different APIs
            if (!isKeyBoardPaste) {
                event.preventDefault();
            }

            setTimeout(function () {
                // Grab HTML from Clipboard API or paste bin as a fallback
                if (that.hasContentType(clipboardContent, 'text/html')) {
                    content = clipboardContent['text/html'];
                } else {
                    content = that.getPasteBinHtml();

                    // If paste bin is empty try using plain text mode
                    // since that is better than nothing right
                    if (content === pasteBinDefaultContent) {
                        plainTextMode = true;
                    }
                }

                content = that.trimHtml(content);

                // WebKit has a nice bug where it clones the paste bin if you paste from for example notepad
                // so we need to force plain text mode in this case
                var pasteBinElm = this.getPasteBin();
                if (pasteBinElm && pasteBinElm.firstChild && pasteBinElm.firstChild.id === 'mcepastebin') {
                    plainTextMode = true;
                }

                that.removePasteBin();

                // If we got nothing from clipboard API and pastebin then we could try the last resort: plain/text
                if (!content.length) {
                    plainTextMode = true;
                }

                // Grab plain text from Clipboard API or convert existing HTML to plain text
                if (plainTextMode) {
                    // Use plain text contents from Clipboard API unless the HTML contains paragraphs then
                    // we should convert the HTML to plain text since works better when pasting HTML/Word contents as plain text
                    if (that.hasContentType(clipboardContent, 'text/plain') && content.indexOf('</p>') === -1) {
                        content = clipboardContent['text/plain'];
                    } else {
                        // What is innerText supposed to do? (It isn't defined)
                        //content = MediumEditor.util.innerText(content);
                        window.console.log('INNER TEXT: ' + content);
                    }
                }

                // If the content is the paste bin default HTML then it was
                // impossible to get the cliboard data out.
                if (content === pasteBinDefaultContent) {
                    if (!isKeyBoardPaste) {
                        that.window.alert('Please use Ctrl+V/Cmd+V keyboard shortcuts to paste contents.');
                    }

                    return;
                }

                if (false === plainTextMode) {
                    return that.cleanPaste(content);
                }

                if (!(that.getEditorOption('disableReturn')/* || element.getAttribute('data-disable-return')*/)) {
                    paragraphs = content.split(/[\r\n]+/g);
                    // If there are no \r\n in data, don't wrap in <p>
                    if (paragraphs.length > 1) {
                        for (p = 0; p < paragraphs.length; p += 1) {
                            if (paragraphs[p] !== '') {
                                html += '<p>' + MediumEditor.util.htmlEntities(paragraphs[p]) + '</p>';
                            }
                        }
                    } else {
                        html = MediumEditor.util.htmlEntities(paragraphs[0]);
                    }
                } else {
                    html = MediumEditor.util.htmlEntities(content);
                }

                return MediumEditor.util.insertHTMLCommand(that.document, html);
            }.bind(this), 0);
        },

        /**
         * Gets various content types out of the Clipboard API. It will also get the
         * plain text using older IE and WebKit API.
         *
         * @param {event} event Event fired on paste.
         * @return {Object} Object with mime types and data for those mime types.
         */
        getClipboardContent: function (event) {
            var dataTransfer = event.clipboardData || this.document.dataTransfer,
                data = {};

            if (!dataTransfer) {
                return data;
            }

            // Use old WebKit/IE API
            if (dataTransfer.getData) {
                var legacyText = dataTransfer.getData('Text');
                if (legacyText && legacyText.length > 0) {
                    data['text/plain'] = legacyText;
                }
            }

            if (dataTransfer.types) {
                for (var i = 0; i < dataTransfer.types.length; i++) {
                    var contentType = dataTransfer.types[i];
                    data[contentType] = dataTransfer.getData(contentType);
                }
            }

            return data;
        },

        createPasteBin: function () {
            var range, rects,
                top = this.window.pageYOffset;

            range = MediumEditor.selection.getSelectionRange(this.document);

            if (range) {
                rects = range.getClientRects();

                // on empty line, rects is empty so we grab information from the first container of the range
                if (rects.length) {
                    top += rects[0].top;
                } else {
                    top += range.startContainer.getBoundingClientRect().top;
                }
            }

            lastRange = range;

            var pasteBinElm = this.document.createElement('div');
            pasteBinElm.id = this.pasteBinId = 'medium-editor-pastebin-' + (+Date.now());
            pasteBinElm.setAttribute('style', 'border: 1px red solid; position: absolute; top: ' + top + 'px; width: 10px; height: 10px; overflow: hidden; opacity: 0');
            pasteBinElm.setAttribute('contentEditable', true);
            pasteBinElm.innerHTML = pasteBinDefaultContent;

            this.document.body.appendChild(pasteBinElm);

            // avoid .focus() to stop other event (actually the paste event)
            this.on(pasteBinElm, 'focus', stopProp);
            this.on(pasteBinElm, 'focusin', stopProp);
            this.on(pasteBinElm, 'focusout', stopProp);

            pasteBinElm.focus();

            MediumEditor.selection.selectNode(pasteBinElm, this.document);

            if (!this.boundHandlePaste) {
                this.boundHandlePaste = this.handlePaste.bind(this);
            }

            this.on(pasteBinElm, 'paste', this.boundHandlePaste);
        },

        removePasteBin: function () {
            if (null !== lastRange) {
                MediumEditor.selection.selectRange(this.document, lastRange);
                lastRange = null;
            }

            var pasteBinElm = this.getPasteBin();
            if (!pasteBinElm) {
                return;
            }

            if (pasteBinElm) {
                this.off(pasteBinElm, 'focus', stopProp);
                this.off(pasteBinElm, 'focusin', stopProp);
                this.off(pasteBinElm, 'focusout', stopProp);
                this.off(pasteBinElm, 'paste', this.boundHandlePaste);
                pasteBinElm.parentElement.removeChild(pasteBinElm);
            }
        },

        getPasteBin: function () {
            return this.document.getElementById(this.pasteBinId);
        },

        getPasteBinHtml: function () {
            var pasteBinElm = this.getPasteBin();
            return pasteBinElm ? pasteBinElm.innerHTML : pasteBinDefaultContent;
        },

        cleanPaste: function (text) {
            var i, elList, tmp, workEl,
                multiline = /<p|<br|<div/.test(text),
                replacements = [].concat(
                    this.preCleanReplacements || [],
                    createReplacements(),
                    this.cleanReplacements || []);

            for (i = 0; i < replacements.length; i += 1) {
                text = text.replace(replacements[i][0], replacements[i][1]);
            }

            if (!multiline) {
                return this.pasteHTML(text);
            }

            // create a temporary div to cleanup block elements
            tmp = this.document.createElement('div');

            // double br's aren't converted to p tags, but we want paragraphs.
            tmp.innerHTML = '<p>' + text.split('<br><br>').join('</p><p>') + '</p>';

            // block element cleanup
            elList = tmp.querySelectorAll('a,p,div,br');
            for (i = 0; i < elList.length; i += 1) {
                workEl = elList[i];

                // Microsoft Word replaces some spaces with newlines.
                // While newlines between block elements are meaningless, newlines within
                // elements are sometimes actually spaces.
                workEl.innerHTML = workEl.innerHTML.replace(/\n/gi, ' ');

                switch (workEl.nodeName.toLowerCase()) {
                    case 'p':
                    case 'div':
                        this.filterCommonBlocks(workEl);
                        break;
                    case 'br':
                        this.filterLineBreak(workEl);
                        break;
                }
            }

            this.pasteHTML(tmp.innerHTML);
        },

        pasteHTML: function (html, options) {
            options = MediumEditor.util.defaults({}, options, {
                cleanAttrs: this.cleanAttrs,
                cleanTags: this.cleanTags
            });

            var elList, workEl, i, fragmentBody, pasteBlock = this.document.createDocumentFragment();

            pasteBlock.appendChild(this.document.createElement('body'));

            fragmentBody = pasteBlock.querySelector('body');
            fragmentBody.innerHTML = html;

            this.cleanupSpans(fragmentBody);

            elList = fragmentBody.querySelectorAll('*');
            for (i = 0; i < elList.length; i += 1) {
                workEl = elList[i];

                if ('a' === workEl.nodeName.toLowerCase() && this.getEditorOption('targetBlank')) {
                    MediumEditor.util.setTargetBlank(workEl);
                }

                MediumEditor.util.cleanupAttrs(workEl, options.cleanAttrs);
                MediumEditor.util.cleanupTags(workEl, options.cleanTags);
            }

            MediumEditor.util.insertHTMLCommand(this.document, fragmentBody.innerHTML.replace(/&nbsp;/g, ' '));
        },

        isCommonBlock: function (el) {
            return (el && (el.nodeName.toLowerCase() === 'p' || el.nodeName.toLowerCase() === 'div'));
        },

        filterCommonBlocks: function (el) {
            if (/^\s*$/.test(el.textContent) && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        },

        filterLineBreak: function (el) {
            if (this.isCommonBlock(el.previousElementSibling)) {
                // remove stray br's following common block elements
                this.removeWithParent(el);
            } else if (this.isCommonBlock(el.parentNode) && (el.parentNode.firstChild === el || el.parentNode.lastChild === el)) {
                // remove br's just inside open or close tags of a div/p
                this.removeWithParent(el);
            } else if (el.parentNode && el.parentNode.childElementCount === 1 && el.parentNode.textContent === '') {
                // and br's that are the only child of elements other than div/p
                this.removeWithParent(el);
            }
        },

        // remove an element, including its parent, if it is the only element within its parent
        removeWithParent: function (el) {
            if (el && el.parentNode) {
                if (el.parentNode.parentNode && el.parentNode.childElementCount === 1) {
                    el.parentNode.parentNode.removeChild(el.parentNode);
                } else {
                    el.parentNode.removeChild(el);
                }
            }
        },

        cleanupSpans: function (containerEl) {
            var i,
                el,
                newEl,
                spans = containerEl.querySelectorAll('.replace-with'),
                isCEF = function (el) {
                    return (el && el.nodeName !== '#text' && el.getAttribute('contenteditable') === 'false');
                };

            for (i = 0; i < spans.length; i += 1) {
                el = spans[i];
                newEl = this.document.createElement(el.classList.contains('bold') ? 'b' : 'i');

                if (el.classList.contains('bold') && el.classList.contains('italic')) {
                    // add an i tag as well if this has both italics and bold
                    newEl.innerHTML = '<i>' + el.innerHTML + '</i>';
                } else {
                    newEl.innerHTML = el.innerHTML;
                }
                el.parentNode.replaceChild(newEl, el);
            }

            spans = containerEl.querySelectorAll('span');
            for (i = 0; i < spans.length; i += 1) {
                el = spans[i];

                // bail if span is in contenteditable = false
                if (MediumEditor.util.traverseUp(el, isCEF)) {
                    return false;
                }

                // remove empty spans, replace others with their contents
                MediumEditor.util.unwrap(el, this.document);
            }
        },

        hasContentType: function (clipboardContent, mimeType) {
            return mimeType in clipboardContent && clipboardContent[mimeType].length > 0;
        },

        /**
         * Trims the specified HTML by removing all WebKit fragments, all elements wrapping the body trailing BR elements etc.
         *
         * @param {String} html Html string to trim contents on.
         * @return {String} Html contents that got trimmed.
         */
        trimHtml: function (html) {
            // Remove anything but the contents within the BODY element
            html = html.replace(/^[\s\S]*<body[^>]*>\s*|\s*<\/body[^>]*>[\s\S]*$/g, '');
            // Inner fragments (tables from excel on mac)
            html = html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, '');
            html = html.replace(/( ?)<span class="Apple-converted-space">\u00a0<\/span>( ?)/g, function (all, s1, s2) {
                // WebKit &nbsp; meant to preserve multiple spaces but instead inserted around all inline tags,
                // including the spans with inline styles created on paste
                if (!s1 && !s2) {
                    return ' ';
                }

                return '\u00a0';
            });
            // Trailing BR elements
            html = html.replace(/<br>$/i, '');

            return html;
        }
    });

    MediumEditor.extensions.paste = PasteHandler;
}());
