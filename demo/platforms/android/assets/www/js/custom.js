$(document).on("click", ".spn-inprogress", function(){location.href='#pageBrowse4';$.mobile.changePage("#pageBrowse4");});
$(document).on("click", ".btnSearch", function(){location.href='#pageSearchResults';$.mobile.changePage("#pageSearchResults");});

$(document).on("click","#btnSelectAll",function(){
		$('.cbSelect').prop('checked',true).checkboxradio('refresh');
		$('#btnSelectAll').text("Select None");
		$('#btnSelectAll').removeClass('ui-btn-active');
		$('#btnSelectAll').removeClass('ui-shadow');
		$('#btnSelectAll').button('refresh');
		return false;
	
	});
	
$(document).on("click","#btnReceivedWD",function(){
	var x;
	if (confirm("Do you want to set delivery VC607 to Received?")==true){
		location.href=("#pageWindowDelivery2");
		
	}
	else{
		$('#btnReceivedWD').removeClass('ui-btn-active');
		$('#btnReceivedWD').removeClass('ui-shadow');
		$('#btnReceivedWD').button('refresh');
	}
	
});
	


//******************************************************************
//*****
//*****				"Performance" improvement code 
//*****
//**************************************************************

$.mobile.defaultPageTransition   = 'none';
$.mobile.defaultDialogTransition = 'none';


$(document).on('pagecontainerbeforechange', function(e, ui){
	if ((typeof(ui.prevPage) != 'undefined') && (typeof(ui.toPage) == "object")) {
				$(ui.toPage).find('.ui-btn-active').each(
					//Sets everything back to defaults...another alternative would be to remove the ui-btn-active etc 
					//classes *before* the new page is being loaded/built? Might remove need for the css calls.
						function(){
							console.log("Each!");
						$(this).removeClass('ui-btn-active');
						$(this).removeClass('ui-shadow');
							});
			console.log("Finished");
	}

});