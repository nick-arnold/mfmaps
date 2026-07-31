/*
 * Markdown editor for the blog admin.
 *
 * Wraps EasyMDE around the body and intro textareas: a toolbar with bold,
 * italic, headings, links, lists, and an image button that uploads straight
 * to Spaces and drops the markdown in at the cursor.
 *
 * The point of this file is that nobody has to know markdown syntax to write
 * a post. If you find yourself explaining what an asterisk does, something
 * here has broken.
 */
(function () {
    'use strict';

    var UPLOAD_URL = '/blog/upload-image/';
    var TARGETS = ['id_body', 'id_intro'];

    function csrfToken() {
        var input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        return input ? input.value : '';
    }

    function build(textarea) {
        var editor = new EasyMDE({
            element: textarea,
            autoDownloadFontAwesome: true,
            spellChecker: false,
            nativeSpellcheck: true,
            forceSync: true,
            autosave: { enabled: false },
            status: ['lines', 'words'],
            placeholder: 'Write here. Use the toolbar \u2014 you never need to type markdown by hand.',

            uploadImage: true,
            imageUploadEndpoint: UPLOAD_URL,
            /* Our endpoint returns a full Spaces URL. Without this EasyMDE
               prepends window.location.origin and you get
               https://mfmaps.com/https://mfmaps-media... */
            imagePathAbsolute: true,
            imageCSRFToken: csrfToken(),
            imageCSRFName: 'csrfmiddlewaretoken',
            imageMaxSize: 25 * 1024 * 1024,
            imageAccept: 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif',
            imageTexts: {
                sbInit: 'Drop an image here, or click the picture button.',
                sbOnDragEnter: 'Drop it to upload.',
                sbOnDrop: 'Uploading\u2026',
                sbProgress: 'Uploading #file_name#: #progress#%',
                sbOnUploaded: 'Uploaded \u2014 add alt text describing the photo.',
                sizeUnits: ' B,KB,MB'
            },
            errorMessages: {
                noFileGiven: 'Pick an image first.',
                typeNotAllowed: 'That file type is not an image we can use.',
                fileTooLarge: 'That image is larger than 25 MB.',
                importError: 'Upload failed. Try again, or use a JPEG.'
            },

            toolbar: [
                'bold', 'italic', '|',
                'heading-2', 'heading-3', '|',
                'quote', 'unordered-list', 'ordered-list', '|',
                'link', 'upload-image', '|',
                'preview', 'side-by-side', 'fullscreen', '|',
                {
                    name: 'guide',
                    action: 'https://www.markdownguide.org/basic-syntax/',
                    className: 'fa fa-question-circle',
                    title: 'Formatting help'
                }
            ]
        });

        /* forceSync keeps the textarea current, but belt and braces: the admin
           has several submit buttons and losing a post to a missed sync would
           be unforgivable. */
        var form = textarea.closest('form');
        if (form) {
            form.addEventListener('submit', function () {
                textarea.value = editor.value();
            });
        }
    }

    function init() {
        if (typeof EasyMDE === 'undefined') {
            return;
        }
        TARGETS.forEach(function (id) {
            var textarea = document.getElementById(id);
            if (textarea && !textarea.dataset.mdeReady) {
                textarea.dataset.mdeReady = '1';
                build(textarea);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();