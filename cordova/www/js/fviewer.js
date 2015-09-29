// This file makes the floorplans respond to gestures 
var x = 0, y = 0, w = -1, h = -1;
var scale = 1,
    floorplan = document.getElementById('fplan'),
    gestureArea = document.getElementById('fgestureArea'),
    resetTimeout;

    $("#zoomin").click(function(){
        scale = scale + 0.25;
        reset();
        updateTransform();
    });
    $("#zoomout").click(function(){
        scale = scale - 0.25;
        updateTransform();
    });
            
// allows user to pinch anywhere on view area, to zoom floorplan
interact(gestureArea).gesturable({
    onstart: function (event) {
        clearTimeout(resetTimeout);
        floorplan.classList.remove('reset');
    },
    onmove: function (event) {
        scale = scale * (1 + event.ds);
        updateTransform();
    },
    onend: function (event) {
        resetTimeout = setTimeout(reset, 100);
        floorplan.classList.add('reset');
    }
});

interact(floorplan)
    // gesturable will only be called when multiple fingers are touching the
    // screen. this should be exactly the same as the gestureArea calls, this
    // just allows zoom when the gesture is performed entirely on the image..
    .gesturable({
        onstart: function (event) {
            clearTimeout(resetTimeout);
            floorplan.classList.remove('reset');
        },
        onmove: function (event) {
            scale = scale * (1 + event.ds);
            updateTransform();
        },
        onend: function (event) {
            resetTimeout = setTimeout(reset, 200);
            floorplan.classList.add('reset');
        }
    })
    // This is called when just the one finger is touching the screen
    .draggable({
        onstart: function (evvent) {
            if (w == -1) {
                w = $('#fplan').width();
                h = $('#fplan').height();
            }
            clearTimeout(resetTimeout);
            floorplan.classList.remove('reset');
        },
        onmove: function (event) {
            // check if width/height have been set
            console.log(h);
            if ((w*scale)>$(window).width())
                x = $('#fplan').position().left + event.dx - ((w*(1-scale))/2);
            if ((h*scale)>$(window).height())
                y = floorplan.getBoundingClientRect().top+1-(($(window).height()/2)-h/2)+event.dy - ((h*(1-scale))/2);
            updateTransform();
        },
        onend: function (event) {
            resetTimeout = setTimeout(reset, 200);
            floorplan.classList.add('reset');
        }
    })
    .inertia(true)
    /*
    .restrict({
        drag: "parent",
        endOnly: true,
        elementRect: { top: 0, left: 0, bottom: 1, right: 1}
    })*/
    ;

function updateTransform () {
    floorplan.style.webkitTransform =
        floorplan.style.transform =
        'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')';
}

// this reset function is called after zooming but will only reset the scale if
// the image is less than it's original size (100% width)
function reset () {
    if (scale < 1) {
        scale = 1;
    }
    if ($('#fplan').position().left > 0)
        x = -((w*(1-scale))/2);
    else if (($('#fplan').position().left+($('#fplan').width()*scale)) < $(window).width())
        x =$(window).width()-((w*(1-scale))/2)-(w*scale);
    if ((h*scale)<$(window).height())
        y = 0;
    else if ($('#fplan').position().top > 0)
        y = -($(window).height()/2)+((h*(scale))/2);
    else if (($('#fplan').position().top+($('#fplan').height()*scale)) < $(window).height())
        y =$(window).height()-((h*(1-scale))/2)-(h*scale)-(($(window).height()/2)-h/2);
 
    updateTransform();
}
// prevent browser's native drag on the image
gestureArea.addEventListener('dragstart', function (event) {
    event.preventDefault();
})
