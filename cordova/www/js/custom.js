/*******************************************************
**     Function info
********************************************************
INIT

UTILITIES
   fPing()
       - pings the server, sets bNetEnabled on success, if you're using hdd
       - storage it checks for updates & triggers download
   fLogin()
       - Checks net + file system availability, then either downloads updates
       - from database, or logs in using local data only
   compressData()
       - uses base64.js and rawdeflate.js to encode data in base 64 and then
       - compress it using gzip
   uncompressData()
       - uses base64.js and rawinflate.js to decode data in base 64 and then
       - decompress it using gzip

STATIC BUTTON FUNCTIONS
   populateListPage()
       - is called by browse menus (Todays Deliveries, Defected Materials etc)
       - to populate filtered list page. This function determines whether to 
       - use the fs or db, and then calls populateDeliveriesList or 
       - populateMaterialsList appropriately
   populateMaterialsList()
       - creates a list of materials based on input data. On clicking each
       - item, takes you to a details page for that delivery
   populateDetails()
       - creates detail page for given deliveries/materials, populates "edit"
       - page @ same time.. ensure that you send it an array even if it only 
       - has one item
   populateSearchFilterList()
       - updates search page based on the entity type you're looking at
       - (i.e. material type/delivery)

DYNAMIC BUTTON FUNCTIONS
    clickListItemMaterials()
        - based on material id, brings up that material's details page
    
DATABASE/SERVER FUNCTIONS
    dbUpdateMaterials()
        - downloads all materials since the last server update & saves to disk

AJAX QUEUE HANDLER & RELATED FUNCTIONS
    fQueueHandler()
        - When called, executes the next function in the array "UpdateQueue",
        - then lops it off the top. 
    setBLocalReady()
        - Sets the variable bLocalReady = true. To indicate when saving has 
        - completed so functions can access filesystem
        
FILESYSTEM FUNCTIONS
    fSaveToDisk()
        - Saves given data to the filesystem with a given filename, then calls 
        - function "funcName"
    fsIndexNSave()
        - creates an index of delivery prids to allow materials to be more 
        - quickly accessed from the local files
    fsUpdateMatRecord()
        - updates a given delivery in the local filesystem, without having to 
        - update from server.
    fsGetLastUpdates()
        - grabs timestamp of local data from the filesystem, so only latest 
        - changes are downloaded
    fsLoadClasses()
        - grabs all local classes info and loads to Classes global variable
    fsLoadLists()
        - grabs all local lists info and loads to Lists global variable
    fsLoadDelIndex()
        - grabs local delivery index and loads it to DelIndex array
    fsLoadMatIndex()
        - grabs local material index and loads it to MatIndex array
*/

//******************************************************************
//*****
//***** "Performance" improvement code 
//*****
//***** Needs to happen before document.ready is fired
//*****
//**************************************************************

$.mobile.defaultPageTransition   = 'none';
$.mobile.defaultDialogTransition = 'none';

$(document).ready(function () {
//******************************************************************
//*****
//***** "Performance" improvement code 
//*****
//**************************************************************

    //This is due to jQuery Mobile not correctly clearing 
    //buttons' active status where transitions are disabled,
    //meaning you end up with greyed buttons whenever you 
    //return to a page you've been before. This fixes that.


//Code needs to be fixed

    if( window.localStorage.getItem("user") ) {
        // window.localStorage.removeItem("userid");
        $.mobile.changePage("#pageHome");
        var params = {user: window.localStorage.getItem("user"),
                      pass: window.localStorage.getItem("pass")};
        queryServer('login',params,function(data){
            if (data == 0) {
                alert("Incorrect username or password.");
            } else {
                userID      = data['userid'];
                authCode    = data['auth'];
                cpid        = window.localStorage.getItem("cpid")
                $.mobile.loading("hide");
                $.mobile.changePage("#pageHome");
                UpdateQueue = [];
                UpdateQueue.push(fPing);
                UpdateQueue.push(fLogin);
                fQueueHandler();
            }
        });
    }

    $(document).on('pagecontainerbeforechange', function (e, ui) {
//        //console.log("pagecontainerbeforechange!");
        if ((typeof(ui.prevPage) != 'undefined') && (typeof(ui.toPage) == "object")) {
            //Sets everything back to defaults
            $(ui.toPage).find('.ui-btn-active').each(function () {
                $(this).removeClass('ui-btn-active');
                $(this).removeClass('ui-shadow');
            });
        }

    });
    // ********************************************************
    // **Globals
    // ********************************************************


        // - Constants
    var C_APPDIR = "matrak"; //const App Directory - where we're storing local files

    var bLocalReady = false; // This flag checks whether enough information is stored in the local file system for it to be used
    // If updates are applied to saved files, this triggers to false while new data is copied, then true once everything's ready for reading
    var bUseFileSystem = false; //Bool - Whether to attempt to use the device filesystem, or get everything directly from server.
    
    var bNetEnabled = false;    //Bool - whether the net is currently connected, based on ping.js webworker/NetWorker variable
    //var NetWorker; //Web worker for checking net connectivity -- !! Note: No web-worker support for Android < 4.4 Best not to try to include it.
    var sDBMatLastUpdated = ""; //String - last time materials server updated, used to decide if downloading new data is required or not.
    
    var sFSMatLastUpdated = ""; //String - last time *filesystem* updated Mat
        
    var UpdateQueue = []; //This contains a list of the functions to call, in order, to store all needed server data locally

    // Variables for storing actual data

    var MatIndex = [];        //This is an array containing a list of the prid & file name on disk for all records
    var iMatFileCount = 0;			//This is an int that stores the number of local material files.

    var CurRecords = [];    // When you view a list of records from filesystem, it stores the details of each one here to stop it needing to make a 2nd lookup when
                                                // the user clicks on something. Not sure how this'll impact memory usage yet...hrm
    var CurEditRecords = [];    //An array of all the detail info for each record that is currently in the "Edit" menu
    
    var iCurRecord = 0;                //This is the current top selected cached record (for managing the number appearing on each page)
    var sCurFilter = [];            //This is the current filter, used for moving to the "next" cached records
    var C_NUM_PAGE_RECORDS = 20; //This is the maximum # records that appear per page
    var C_NUM_RECORD_FS_FILES = 1000; //This is the maximum # records per filesystem file
        

    var MatLists = {}; // Store lists in an associative array
    var MatTypes = {}; // Use this to link material id's with name + is_container
    var MatDescriptions = {}; // all valid descriptions for each material type
    var MatPopulatedList = {}; // latest list of populated materials + descriptions

    var BrowseMaterialLists = {};
    var BrowseMaterialFilter = {};

    // bulkUpdateArrayCount tells you the total amount of items that will be
    // placed in the array, so you know when to call the next function
    var bulkUpdateArrayCount = 0;
    var bulkUpdateArray = [];

    var isLoadingPage = false; // this is used to determine whether the loading animation needs to display. This was necessary as often the lists are populated before pageshow is called, which is when the animation would usually be displayed

    // User Authentication
    // Upon logging in successfully, the server will send a userID, authCode and
    // cpid that shall be sent with every query to prove authentication
    var userID;
    var authCode;
    var cpid; // This refers to the active current/project being used

    // ********************************************************
    // **Init
    // ********************************************************

    //Speed up clicks
    FastClick.attach(document.body); // !!I'm pretty dubious if this has any affect...certainly not on Android. iphone do anything?

    //Detect of mobile device or not

    if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
        //Need to make this more intelligent. It should determine if filesystem
        //is accessible and has enough space before confirming it'll use it
        bUseFileSystem = true;
        //console.log("Using filesystem");

    }
       
    //Start pinging the server to test net connectivity
    fPing();    //Fire once immediately!
    
    var objTimer = setInterval(function(){fPing()}, 10000);    //Start pinging server every 10 secs

    // This will tell ajax to print a useful error message whenever it fails
    $.ajaxSetup({
        error: function(xhr, status, error) {
            alert("An AJAX error occured: " + status + "\nError: " + error);
        }
    });

    //Show login page
    $('#pageLogin').on('pageshow',function(e,data){
        $('#pageLogin-content').css('margin-top',($(window).height() - $('[data-role=header]').height() - $('[data-role=footer]').height() - $('#index-content').outerHeight())/2);
    });

    // bind these here, so that they aren't binded multiple times..
    $(document).on("click", ".listitemMaterials", clickListItemMaterials);
    $(document).on("click", ".listitemBrowse", clickListItemBrowse);

    //Associate the "Next" list item with grabbing the next 25 records
    $(document).on("click", ".listitemNext", function(){
        iCurRecord = iCurRecord + C_NUM_PAGE_RECORDS;
        ////console.log("Triggering populateListPage for record " + iCurRecord + " and filter " + JSON.stringify(sCurFilter));
        populateListPage(iCurRecord,sCurFilter);
        
    });

    // ********************************************************
    // ** Utilities
    // ********************************************************

	function fPing(){
		//This code will be replaced once the LastUpdated function is moved to queryServer function
		queryServer('getlastupdated',{},fPingResponse);			
	}


    function fPingResponse(data){   
    
        console.log("Ping Response!"); 
    	bNetEnabled = true;

		//Is the local data up to date?
		if (!(sDBMatLastUpdated == data.timestamp)){
		    sDBMatLastUpdated = data.timestamp;
		    //console.log("New materials updates! " + sDBMatLastUpdated);            
		}
		//Check if the file system is present + up to date
		if (bUseFileSystem == true) {
	    	//Do we have a data mismatch?
	    	if (!(sDBMatLastUpdated == sFSMatLastUpdated)){
	    
    	  	  	if ((bLocalReady == true)){    //If there's not already scheduled updates in the queue...
    		        //console.log("Updating based on new materials");            
    		        bLocalReady = false;
    		        UpdateQueue.push(dbUpdateMaterials); //Need to update the database
      		        UpdateQueue.push(SetbLocalReady);
    		        fQueueHandler();
    	    	} else{}
	    	}
	    	else{}
    	}

    }
        
    function fLogin(){
        //This function loads a given project, based on net/filesystem access, and what data (if any) is stored locally.

        //Start by grabbing classes
        bLocalReady = false; //Stop allowing the device to read locally, coz we're doing a lot of saves atm...
        
        //First confirm if there's anything locally stored
        if(bUseFileSystem){
            UpdateQueue.push(fsGetLastUpdates);
        }
        
        //Now try to load home page, depending on if anything's stored locally.
        UpdateQueue.push(fLoadStartPage);
        
        // Rest of the stuff only works if there's internet...
        
        if(bNetEnabled){
            //console.log("Net available: downloading data");
            
            UpdateQueue.push(dbGetLists);
            UpdateQueue.push(dbGetTypes);
            UpdateQueue.push(dbGetDescriptions);
        }
        if (bUseFileSystem){
            UpdateQueue.push(fsLoadTypes);
            UpdateQueue.push(fsLoadLists);
            UpdateQueue.push(fsLoadDescriptions);
            UpdateQueue.push(dbUpdateMaterials);
            UpdateQueue.push(fsLoadMatIndex);
            UpdateQueue.push(SetbLocalReady);
        }
        fQueueHandler();
    }
        
    function fLoadStartPage(){
        if(((sFSMatLastUpdated=="")) && (bNetEnabled==false)){
            //This basically says - you've got no data stored locally, and no net connectivity... so don't allow login.
            ////console.log("Not loading! sFSDelLastUpdated: " + sFSDelLastUpdated + " sFSMatLastUpdated: " + sFSDelLastUpdated + " bNetEnableD: " + bNetEnabled);
            alert("Cannot connect to server, and no data stored locally. Unable to login.");
            
            UpdateQueue = [];    //Nuke any planned functions for now
            $.mobile.changePage("#pageLogin");
        }
        else{
            
            if(bNetEnabled==false){
                alert("Please note: No internet connectivity. Using data last saved at " + sFSMatLastUpdated);
            }
            
            //console.log("Triggering home page");
  			$.mobile.changePage("#pageHome");
			fQueueHandler();    //Get back to it!
        }

    }

    // this function is used to store all entities in an array before calling
    // populateDetails() as currently deliveries/materials need to gotten
    // individually
    function addToBulkUpdateArray(data){
        bulkUpdateArray[bulkUpdateArray.length] = data;
        if (bulkUpdateArray.length == bulkUpdateArrayCount){
            populateDetails(bulkUpdateArray);
        }
    }

    function compressData(data) {
        var c = Base64.toBase64(RawDeflate.deflate(Base64.utob(data)));
        return c;
    }

    function uncompressData(data) {
        var c = Base64.btou(RawDeflate.inflate(Base64.fromBase64(data)));
        return c;
    }

    // ********************************************************
    // **Static Buttons onClick
    // ********************************************************

    // Login button on pageLogin
    // updates everything when logging in
    // if no fs is present, fLogin will only download classes/lists
    $("#hrefLogin").click(function(){
        if ((bNetEnabled == false) && (false==bUseFileSystem)){
            // Won't login if can't access FS or net 
            alert("Can't connect to network! Please try again later.");
            $.mobile.changePage("#pageLogin");
        } else {
            $.mobile.loading( "show" );
            var params = {user: $("#txtUsername").val(),
                          pass: $("#txtPassword").val()};
            queryServer('login',params,function(data){
                if (data == 0) {
                    alert("Incorrect username or password.");
                } else {
                    userID      = data['userid'];
                    authCode    = data['auth'];
                    cpid        = data['cpid'];
                    $.mobile.loading( "show" );
                    queryServer("getuserinfo", {}, cbSelectProject);
                }
            });
        }
    });

    var cbSelectProject = function( res ) {
        console.log(JSON.stringify(res));
        var access = res.access;
        $("#projects").html("");
        for( var i = 0; i < access.length; i++ ) {
            $("#projects").append("<option value='"+access[i]["company_project_id"]+"'>"+access[i]["project_name"]+"</option>");
        }
        $.mobile.changePage( "#pageSelectProject" );
        $('#projects').selectmenu('refresh');
        $(".loggedinAsTxt2").html( "&nbsp;&nbsp;"+res.details.username );
    }

    var savLoginDetails = function( userID, authCode, cpid ) {
        window.localStorage.setItem( "user", $("#txtUsername").val());
        window.localStorage.setItem( "pass", $("#txtPassword").val());
        window.localStorage.setItem( "cpid", cpid );
    }

    $("#hrefContinue").click(function(){
        cpid = $("#projects").val();
        if( $(".saveLoginDetails").is(":checked") ) {
            savLoginDetails( userID, authCode, cpid );
        }
        $.mobile.changePage("#pageHome");
        UpdateQueue = [];
        fLogin();
    });

    // Temporarily using the support button to test new API
    $("#hrefSupport").click(function(){
        //queryServer('addmaterials',{"matList":[{"d":{"9":"STI123","10":"Not Delivered","11":"300KG","12":"Not Delivered","13":""},"t":"2","descIds":[9,10,11,12,13],"pid":"null"},{"d":{"14":"WIN321","15":"Manufactured","16":"Not Delivered","17":"","18":"30mm glass, XYZ400","19":""},"t":"3","descIds":[14,15,16,17,18,19],"pid":"null"}]},
        queryServer('addtocontainer',{"materialID":9937,"parentID":9053},
            function(data){
                console.log("Success!");
                console.log(data);
        });
    });

    // Find Deliveries button on Deliveries page
    $("#hrefFindDeliveries").click(function(){
        var searchTypeHtml = "";
        for (var mid in MatTypes){
            searchTypeHtml += '<option ';
            if (MatTypes[mid].name == 'Delivery') { // Select the current option
                searchTypeHtml += 'selected="selected" ';
            } 
            searchTypeHtml += 'value="' + mid + '">' + MatTypes[mid].name
                           + '</option>';
        }
        $("#searchBack").attr("href","#pageDeliveries");
        $('#selectSearchType').html(searchTypeHtml);
        $("#selectSearchType").trigger('create');
        populateSearchFilterList();
    });

    // Find Materials button on Materials page
    $("#hrefFindMaterials").click(function(){
        var searchTypeHtml = "";
        var haveSelectedOption = false;
        for (var mid in MatTypes){
            searchTypeHtml += '<option ';
            if (haveSelectedOption == false && MatTypes[mid].name != 'Delivery') { // Select the current option
                searchTypeHtml += 'selected="selected" ';
                haveSelectedOption = true;
            } 
            searchTypeHtml += 'value="' + mid + '">' + MatTypes[mid].name
                           + '</option>';
        }
        $("#searchBack").attr("href","#pageMaterials");
        $('#selectSearchType').html(searchTypeHtml);
        $("#selectSearchType").trigger('create');
        populateSearchFilterList();
    });

    // Browse Materials button on Materials page
    $("#hrefBrowseMaterials").click(function(){
        BrowseMaterialFilter = new Object;
        prepareBrowsePage();
    });

    $('#browseSelect').on('change', function(){
        populateBrowseList();
    });

    // ListView button on Browse Materials page 
    $('#btnListView').click(function(){
        $("#listHeader").html("Browse Materials");
        $("#listBack").attr("href","#pageBrowse");

        var params = {'cleverFilter':BrowseMaterialFilter, 'start':0, 'limit':10};
        populateListPage(0,params);

        location.href='#pageList';
        $.mobile.changePage("#pageList");
    });

    // Today's Deliveries button on pageDeliveries
    $("#hrefTodaysDeliveries").click(function(){
        $("#listHeader").html("Today's Deliveries");
        $("#listBack").attr("href","#pageDeliveries");
        alert('Feature not active');
        return;

        //Get today's date
        var fullDate = new Date();////console.log(fullDate);
        var twoDigitMonth = fullDate.getMonth()+1+"";
        if(twoDigitMonth.length==1) 
            twoDigitMonth="0" +twoDigitMonth;

        //Added 1 to month...js assumes jan = 0 durp.
        ////console.log(fullDate.getMonth());
        
        var twoDigitDate = fullDate.getDate()+"";
        if(twoDigitDate.length==1)
            twoDigitDate="0" +twoDigitDate;

        var currentDate = twoDigitDate + "-" + twoDigitMonth + "-" + 
                          fullDate.getFullYear();////console.log(currentDate);

        //Set filter so we only return todays deliveries
        var sFilter = [];
        sFilter.push({'field':'Delivery Date','value':currentDate});
        populateListPage(0,sFilter);
    });

    // Expected Deliveries button on pageDeliveries
    $("#hrefExpectedDeliveries").click(function(){
        $("#listHeader").html("Expected Deliveries");
        $("#listBack").attr("href","#pageDeliveries");
        alert('Feature not active');
        return;
        //Set filter so we only return Received deliveries
        //These are the status's we're looking for if something is "Expected"
        var sFilter = [{'field':'Status','value': 'In Transit'}];
        populateListPage(0,sFilter);
    });

    // Received Deliveries button on pageDeliveries
    $("#hrefReceivedDeliveries").click(function(){
        $("#listHeader").html("Received Deliveries");
        $("#listBack").attr("href","#pageDeliveries");
        alert('Feature not active');
        return;
        //Set filter so we only return Received deliveries
        var sFilter = [{'field':'Status','value': 'Received'}];
        populateListPage(0,sFilter);
    });

    $("#hrefRecentlyDeliveredMaterials").click(function(){
        $("#listHeader").html("Received Materials");
        $("#listBack").attr("href","#pageMaterials");
        alert('Feature not active');
        return;
        //Set filter so we only return on site deliveries
        var sFilter = [{'field':'Status','value': 'On Site'}];
        populateListPage(0,sFilter);
    });


    $("#hrefRecentlyInstalledMaterials").click(function(){
        $("#listHeader").html("Recently Installed Materials");
        $("#listBack").attr("href","#pageMaterials");
        alert('Feature not active');
        return;
        //Update list page accordingly:
        var sFilter = [{'field':'Status','value': 'Installed'}];
        populateListPage(0,sFilter);
    });

    $("#hrefDefectiveMaterials").click(function(){
        $("#listHeader").html("Defective Items");
        $("#listBack").attr("href","#pageMaterials");
        alert('Feature not active');
        return;
        //Update list page accordingly:
        var sFilter = [{'field':'Status','value': 'Defective'}];
        populateListPage(0,sFilter);
    });

    //When the 'search for' option is changed repopulate the search filter list
    $('#selectSearchType').on('change', function(){
        populateSearchFilterList();
    });

    // Search button on pageSearch 
    $('#btnSearch').click(function(){
        $("#listHeader").html("Seach Results");
        $("#listBack").attr("href","#pageSearch");

        // Populate sFilter based on the values in the inputboxes
        var searchType = document.getElementById("selectSearchType").value;
        var sFilter = [];
        
        var i = 0;
        for(var desc in MatDescriptions[searchType]){
            var curFilter = document.getElementById("input" + i);
            var curDesc = MatDescriptions[searchType][desc];
            if (curFilter.nodeName == "INPUT") {
                if (curFilter.value != "") {
                    sFilter.push({'field':curDesc.descId,'value':curFilter.value});
                }
            } else if (curFilter.nodeName == "SELECT") {
                if (curFilter.selectedIndex != 0) {
                    sFilter.push({'field':curDesc.descId,
                        'value':curFilter.options[curFilter.selectedIndex].text});
                }
            }
            i++;
        }
        var params = {'filter':sFilter,'material_type_id':document.getElementById("selectSearchType").value, 'start':0, 'limit':10};
        
        //console.log("Filter: " + JSON.stringify(sFilter));

        populateListPage(0,params);

        location.href='#pageList';
        $.mobile.changePage("#pageList");
    });
    
    // Select button on listpage
    $('#listSelect').click(function(){
        if (document.getElementById('listpageList').style.display != "none") {
            $("#listpageList").css("display","none");
            $("#listpageCB").css("display","block");
            $('#listSelect').text("Edit");
            $('#listBack').text("Cancel");
            $('#listHeader').attr('data-origtext',$('#listHeader').text());
            $('#listHeader').text("Select Items..");

            // this stops it from following the link to #pageDetail
			alert("ok");
			// Martin add
			$('#btnAutoSet').text("Set ...");
            return false;
        } else {
            $("#listItemDetailsList").html("<li>Loading...</li>");
            $('#listItemDetailsList').listview().listview('refresh');
            var count = $("#listpageCB input:checked").length;
            // bulkUpdateArray will contain data for each entity, but needs to
            // be called individually. so we'll set the total items needed to be
            // fetched, and then fetch them individually.
            // addToBulkUpdate() will call populateDetails() once
            // bulkUpdateArray is full.
            bulkUpdateArray = [];
            bulkUpdateArrayCount = count;
            for (var i = 0; i < count; i++)
            {
                var iPrid = $("#listpageCB input:checked")[i].value;
                MatPopulatedList[iPrid]['id'] = iPrid;
                addToBulkUpdateArray(MatPopulatedList[iPrid]);
            }
        }
        $('#listSelect').removeClass('ui-btn-active ui-focus');
    });

    // Cancel/Back button on listpage
    $('#listBack').click(function(){
        if (document.getElementById('listpageList').style.display == "none") {
            $("#listpageList").css("display","block");
            $("#listpageCB").css("display","none");
            $('#listSelect').text("Select");
            $('#listBack').text("Back");
            $('#listHeader').html($('#listHeader').data("origtext"));
            //$('#listBack').attr("href",$('#listBack').data("orighref"));

            // this cancels the default behaviour (following the link)
			// Martin add
			$('#btnAutoSet').text("Set ...");
            return false;
        } else {
           $("#listpageCB").remove();
        }
    });
    
	//2015 6 13 Martin
	$('#btnAutoSet').click(function(){
		var curr = $('#btnAutoSet').text();
		if( curr.slice(-3) != '...' ){
			var real = curr.slice(4);
			var r = confirm("Do you want to set this to " + real + "?");
			if (r == true) { // save
				var descArray = [];
				var valueArray = [];				
				//Check each input box to see what changes have been made
				var i = 0;
				var curField = $("#edit_f0");
				while (curField.length == 1){
					if(curField.data("origvalue") != curField.val()){
						descArray.push(curField.data("descid"));
						if(curField.data("descid") == 'Status'){
							valueArray.push(real);
						}					
						else{
							valueArray.push(curField.val());
						}
					}
					curField = $("#edit_f" + ++i);
				}
		
				var idArray = [];
				for (var i = 0; i < CurEditRecords.length; i++) {
					idArray.push(CurEditRecords[i].id);
				}
		
				if (bNetEnabled == true){
				//Create parameters to send to server
					var params = {idarray: idArray, descarray: descArray,
								  valuearray: valueArray};
					queryServer('bulkupdatematerials',params,function(data){
						//console.log(data);
						if (data == "Not sufficient access") {
							alert("You do not have sufficient access to change these records");
						} else {
							//Save all changes to CurEditRecords
							for (var i = 0; i < CurEditRecords.length; i++) {
								for (var j = 0; j < descArray.length; j++)
									CurEditRecords[i].d[descArray[j]] = valueArray[j];
							}
							//console.log('Bulk Materials Saved');		
						}
						// repopulate detail page once everything is saved
						populateDetails(CurEditRecords);
					});
				} else {
					alert("You currently need to be online to save changes!");
				}
			}
		}
	});

    // Save Button on pageDetailEdit
    $('#btnSave').click(function(){
        var descArray = [];
        var valueArray = [];
        
        //Check each input box to see what changes have been made
        var i = 0;
        var curField = $("#edit_f0");
        while (curField.length == 1){
            if(curField.data("origvalue") != curField.val()){
                descArray.push(curField.data("descid"));
                valueArray.push(curField.val());
            }
            curField = $("#edit_f" + ++i);
        }

        var idArray = [];
        for (var i = 0; i < CurEditRecords.length; i++) {
            idArray.push(CurEditRecords[i].id);
        }

        if (bNetEnabled == true){
        //Create parameters to send to server
            var params = {idarray: idArray, descarray: descArray,
                          valuearray: valueArray};
            queryServer('bulkupdatematerials',params,function(data){
                //console.log(data);
                if (data == "Not sufficient access") {
                    alert("You do not have sufficient access to change these records");
                } else {
                    //Save all changes to CurEditRecords
                    for (var i = 0; i < CurEditRecords.length; i++) {
                        for (var j = 0; j < descArray.length; j++)
                            CurEditRecords[i].d[descArray[j]] = valueArray[j];
                    }
                    //console.log('Bulk Materials Saved');

                }
                // repopulate detail page once everything is saved
                populateDetails(CurEditRecords);
            });
        } else {
            alert("You currently need to be online to save changes!");
        }
    });


	$("#hrefLogout").click(function(){
		$("#hrefLogOut2").click();
	});

	$("#hrefLogOut2").click(function(){
		
		//Reset the main variables
			
		bLocalReady = false; // This flag checks whether enough information is stored in the local file system for it to be used
		//bUseFileSystem = false; //Don't remove this...you may want it
		//bNetEnabled = false;    //Don't remove this...you may want it
		sDBMatLastUpdated = ""; //String - last time materials server updated, used to decide if downloading new data is required or not.
		sFSMatLastUpdated = ""; //String - last time *filesystem* updated Mat
		UpdateQueue = []; //This contains a list of the functions to call, in order, to store all needed server data locally
		MatIndex = [];        //This is an array containing a list of the prid & file name on disk for all records
		iMatFileCount = 0;			//This is an int that stores the number of local material files.
		CurRecords = [];    // When you view a list of records from filesystem, it stores the details of each one here to stop it needing to make a 2nd lookup when
		CurEditRecords = [];    //An array of all the detail info for each record that is currently in the "Edit" menu    
		iCurRecord = 0;                //This is the current top selected cached record (for managing the number appearing on each page)
		sCurFilter = [];            //This is the current filter, used for moving to the "next" cached records
		MatLists = {}; // Store lists in an associative array
		MatTypes = {}; // Use this to link material id's with name + is_container
		MatDescriptions = {}; // all valid descriptions for each material type
		MatPopulatedList = {}; // latest list of populated materials + descriptions
		bulkUpdateArrayCount = 0;
		bulkUpdateArray = [];
		
		userID = 0;
		authCode = 0;
		cpid = 0;
		
		window.localStorage.removeItem("user");
		window.localStorage.removeItem("pass");
		window.localStorage.removeItem("cpid");
			
	});
		
	$("#hrefChangeProject").click(function(){
			
		//This forces them to select their default project next time they log in
		window.localStorage.removeItem("user");
		window.localStorage.removeItem("pass");
		window.localStorage.removeItem("cpid");
		$.mobile.changePage("#pageSelectProject");
	});
	

    // ********************************************************
    // **Dynamic Screen Populate functions
    // ********************************************************

    // this function is used to populate the list page, and is called by
    // Today's Deliveries, Received Delieries, Defected Materials etc..
    function populateListPage(startRec, sFilter){
        $("#listpageList").html("Loading...");
        $('#listpageList').listview().listview('refresh');
        
        var LoadInterval = setInterval(function () {
        $.mobile.loading('show');
        clearInterval(LoadInterval);
            }, 1);
        isLoadingPage = true; // this will become false once list is populated

        // update CurRecords for multiple page viewing
        iCurRecord = startRec;
        sCurFilter = jQuery.extend({}, sFilter); // copy sFilter into sCurFilter

        // if filter is a cleverFilter, we'll need to fetch from server
        if (bUseFileSystem == false || sFilter.cleverFilter != null){
            //console.log("Getting materials data from server");
            //This performs an AJAX call to grab all delivery information off
            //the server, then populate the list view. 
            queryServer('getmatdescriptions',sFilter,populateMaterialsList);
        } else {
            //console.log("Getting materials data from file system");
            
            fsGetMaterials(startRec,sFilter,populateMaterialsList);
        }
    }

    function prepareBrowsePage() {
        $("#browseList").html("");
        $('#browseList').listview().listview('refresh');

        var LoadInterval = setInterval(function () {
            $.mobile.loading('show');
            clearInterval(LoadInterval);
        }, 1);
        isLoadingPage = true; // this will become false once list is populated

        var query = new Object;
        query['filter'] = BrowseMaterialFilter;
        queryServer('browsematerials',query, populateBrowsePage);
    }

    function populateBrowsePage(data) {
        var browseSelectHtml = "";
        for (var i in data){
            browseSelectHtml += '<option value="'+i+'">'+i+'</option>';
        }
        $('#browseSelect').html(browseSelectHtml);
        $("#browseSelect").trigger('create');
        $("#browseSelect").trigger('change');

        BrowseMaterialLists  = data;
        populateBrowseList();
        // This gets rid of the loading animation
        isLoadingPage = false;
        $.mobile.loading("hide");
    }

    function populateBrowseList() {
        var list = document.getElementById("browseSelect").value; 
        var listHtml = "";

        for (var i in BrowseMaterialLists[list]) {
           console.log(BrowseMaterialLists[list][i]); 
           listHtml += '<li><a href="#pageBrowse" data-filter="'+document.getElementById("browseSelect").value+'" data-value="'+BrowseMaterialLists[list][i].item+'" class="listitemBrowse">'+BrowseMaterialLists[list][i].item+'<span class="ui-li-count old-content">'+BrowseMaterialLists[list][i]['status'][3]+'</span><span class="ui-li-count old-content">'+BrowseMaterialLists[list][i]['status'][2]+'</span><span class="ui-li-count old-content">'+BrowseMaterialLists[list][i]['status'][1]+'</span><span class="ui-li-count new-content">'+BrowseMaterialLists[list][i]['status'][0]+'</span></a></li>';
        }

        $('#browseList').html(listHtml);
        $("#browseList").trigger('create');
        $('#browseList').listview().listview('refresh');
    }

    function populateDeliveriesList(data){
        ////console.log("Populating deliveries list");
        ////console.log(JSON.stringify(data));

        //Data referenced like this: data.output[1]["Material Type"]
        var i = 0; //index for 'r' 
        var r = []; //This is an array where we'll store the html for the list items

        //This string will store html for checkbox items
        var cbox = '<fieldset id="listpageCB" data-role="controlgroup" '+
                   'data-iconpos="right" class="ui-controlgroup">'+
                   '<div class="ui-controlgroup-controls">';

        $.each(data.output, function(j, item) {
            ////console.log("Generating list item...");
            //Create list row for each delivery
            r[i++] = "<li><a href='#pageDetail' id='" + item.primary_id +
                     "' class='listitemDeliveries'>";
            r[i++] = "<h2>"+item['Company']+"</h2><p><strong>Delivery ID: "+item['Delivery ID']+"</strong></p><p>Delivery Date: "+item['Delivery Date']+"</p><p class='ui-li-aside'><strong>7:30</strong>AM</p>"
            r[i++] = "</a></li>";

            //Create checkbox item for each delivery
            cbox += '<label for="cb-'+item.primary_id+
                    '" class="ui-btn">'+item['Delivery ID']+'</label>'+
                    '<input type="checkbox" id="cb-'+item.primary_id+'" value="'
                    +item.primary_id+'" data-type="delivery">';
        });
        
        cbox += '</div></fieldset>';
        
        if (data.output.length == C_NUM_PAGE_RECORDS){
            //console.log("Adding next button: " + data.output.length);
            r[i++] = "<li><a href='#pageList' id='btnNext' "+
                         "' class='listitemNext'>";
            r[i++] = "<h2>Next Page...</h2>"
            r[i++] = "</a></li>";
          }

        //console.log("Adding html and generating whatsythang");
        

        //This joins all of the elements in the array into one long string.
        $('#listpageList').html(r.join(''));
        $("#listpageList").trigger('create');
        $('#listpageList').listview().listview('refresh');
        $("#pageListCheckboxes").html(cbox);
        $("#listpageCB").css("display","none");
        
        $("#pageListCheckboxes").trigger("create");    
        
        // This gets rid of the loading animation
        isLoadingPage = false;
        $.mobile.loading("hide");
    }
    
    function populateMaterialsList(origData){
        // data may be contained in object 'items' or just raw
        var data = {};
        if (origData.items)
            data = origData.items;
        else
            data = origData;
        MatPopulatedList = data;

        var listHtml = ""; // dynamic html for listbox

        //This string will store html for checkbox items
        var cbox = '<fieldset id="listpageCB" data-role="controlgroup" '+
                   'data-iconpos="right" class="ui-controlgroup">'+
                   '<div class="ui-controlgroup-controls">';
        
        for (var i in data) {
            var desc1 = data[i].d[MatDescriptions[data[i].t][0].descId]
            var desc2 = data[i].d[MatDescriptions[data[i].t][1].descId]
            var desc3 = data[i].d[MatDescriptions[data[i].t][2].descId]

            //Create row for each material
            listHtml += "<li><a href='#pageDetail' id='" + i +
                     "' class='listitemMaterials'>";
            listHtml += "<h2>"+desc1+"</h2><p><strong>Material Type: "
                     +MatTypes[data[i].t].name+"</strong></p><p>"+desc2+"</p><p class='ui-li-aside'><strong>"+desc3+"</strong></p>"
            listHtml += "</a></li>";

            //Create checkbox item for each material
            cbox += '<label for="cb-'+i+
                    '" class="ui-btn">'+desc1+'</label>'+
                    '<input type="checkbox" id="cb-'+i+'" value="'
                    +i+'" data-type="material">';
            
                
        }
        if (Object.keys(data).length == C_NUM_PAGE_RECORDS){
            listHtml += "<li><a href='#pageList' id='btnNext' "+
                         "' class='listitemNext'>";
            listHtml += "<h2>Next Page...</h2>"
            listHtml += "</a></li>";
          }

        //This joins all of the elements in the array into one long string.
        $('#listpageList').html(listHtml);
        $("#listpageList").trigger('create');
        $('#listpageList').listview().listview('refresh');
        cbox += '</div></fieldset>';
        $("#pageListCheckboxes").html(cbox);
        $("#listpageCB").css("display","none");
        
        $("#pageListCheckboxes").trigger("create");    
        
        
        // This gets rid of the loading animation
        isLoadingPage = false;
        $.mobile.loading("hide");
    }
    
	// Martin
	$("#listItemDetailsList").on('click', 'span', function (){
		var num = $(this).attr('id');
		if( num != ""){
			var r = confirm("Do you want to call this number?");
			if (r == true) {
				document.location.href = 'tel:' + num;
			}
		}				
	});	
	
	//Martin add
//	$( "#datepicker" ).datepicker();
//	$( "#timepicker" ).timepicker();    
    // this function populates all the fields on the detail and edit pages
    // based on the deliveries/materials provided in dataArray
    function populateDetails(dataArray){
    	
    	//console.log("Populating details w/ " + JSON.stringify(dataArray));

        // start downloading children asap
        $('#listItemInventory').css("display","none");
        if (dataArray.length == 1) {
            queryServer('getmaterialchildren',{prid: dataArray[0].id},
                        populateInventory);
        }
        
        console.log("Bam!");

        //Store information so you can compare oldvals to newvals when editing
        CurEditRecords = dataArray;
        var data = dataArray[0];     

        //This is a string where we'll store the html for the list items on the
        //details page
        var detailsListHtml = "";
        //This is a string where we'll store the html for the list items on the
        //edit page
        var editListHtml = "";

        // for each description of the material, do they all have matching values?
        var matchingValues;
        var value;

        // for each valid description of the material type..
        for (var i in MatDescriptions[dataArray[0].t]) {
            var desc = MatDescriptions[dataArray[0].t][i];
            matchingValues = true; // true until proven false
            var value = dataArray[0].d[desc.descId];
            if (!value) value = "";
            // ..check each material..
            for (var j = 0; j < dataArray.length; j++) {
                // ..and see if they have the same value
                if (dataArray[j].d[desc.descId] != value) {
                    matchingValues = false;
                    break;
                }
            }
            // if all materials have the same value for this description
            if (matchingValues == true) {
                //if this detail has a value
                if (value != "") {
                    //Create row for each list item on the details page
                    // Martin
					if( desc.d == "Status" ){
						for(var j = 0; j < MatLists[desc.l].length; j++) {
							if ((MatLists[desc.l][j] == value) && (j+1 < MatLists[desc.l].length)) {
								$("#btnAutoSet").text( "Set " + MatLists[desc.l][(j+1)]);
							}
						}
					}
					if( desc.t == "phone" ){
						detailsListHtml += "<li><b>" + desc.d + ":</b> <span id='" + value + "'>" + value + "</span></li>";
					}
					else{						
						detailsListHtml += "<li><b>" + desc.d + ":</b> " + value + "</li>";
					}
				}

                //Create row for each list item on the edit page
                //Different form objects will have different html

                // if it's not a list, create an input box
                if (desc.t != "list") {
                    editListHtml += '<li data-role="fieldcontain"><label for='
                                 + '"input' + i + '"><b>'
                                 + desc.d
                                 + ':</b></label><input type="text" name="input'
                                 + i + '" id="edit_f' + i;
					if( desc.t == "date") {
						editListHtml += '" class="datepicker';						 
					}
					else if( desc.t == "time") {
						editListHtml += '" class="timepicker';
					}
					editListHtml +=	'" value="'
                                 + value
                                 + '" data-origvalue="'
                                 + value 
                                 + '" data-descid="'
                                 + desc.descId
                                 +'"></li>';
                } else { // Otherwise create a list box
                    editListHtml += '<li data-role="fieldcontain"><label for='
                                    + '"select' + i + '"><b>'
                                    + desc.d 
                                    + ':</b></label><select name="select' + i
                                    + '"id="edit_f' + i 
                                    + '" data-origvalue="'
                                    + value
                                    + '" data-descid="'
                                    + desc.descId 
                                    +'">';
                    for(var j = 0; j < MatLists[desc.l].length; j++) {
                        editListHtml += '<option ';
                        // Select the current option
                        if (MatLists[desc.l][j] == value) {
                            editListHtml += 'selected="selected" ';
                        } 
                        editListHtml += 'value="' + MatLists[desc.l][j] + '">'
                                           + MatLists[desc.l][j] + '</option>';
                    }
                    editListHtml += '</select></li>';
                }
            } else { // if they have different values

                //Create row for each list item on the edit page
                //Different form objects will have different html
                //Detail won't have values as they aren't matching

                // if it's not a list, create an input box
                if (desc.t != "list") {
                    editListHtml += '<li data-role="fieldcontain"><label for='
                                 + "\"input" + i + "\"><b>"
                                 + desc.d
                                 + ':</b></label><input type="text" name="input'
                                 + i + '" id="edit_f' + i
                                 + '" data-descid="'
                                 + desc.descId 
                                 + '" data-origvalue="" value=""></li>';
                } else { // Otherwise create a list box
                    editListHtml += "<li data-role=\"fieldcontain\"><label for="
                                    + "\"select" + i + "\"><b>"
                                    + desc.d
                                    + ":</b></label><select name=\"select" + i
                                    + "\"id=\"edit_f" + i
                                    + '" data-descid="'
                                    + desc.descId 
                                    + "\">";
                    editListHtml += '<option selected="selected" value="Mixed">'
                                 + 'Mixed</option>';
                    for(var j = 0; j < MatLists[desc.l].length; j++) {
                        editListHtml += '<option value="'+MatLists[desc.l][j]+'">'
                                     + MatLists[desc.l][j] + '</option>';
                    }
                    editListHtml += '</select></li>';
                }
            }
        }

        ////console.log("Adding html for dynamic lists in Detail and Edit pages");
        
        //This code is only triggered where the user gets to the detail page
        //via the bulk update/select->edit pages.
        if (dataArray.length > 1) {
            $("#detailHeader").html("Bulk Update");
            $("#detailEditHeader").html("Bulk Update");
			// Martin
			$("#btnAutoSet").text( "Set ...");
        } else {
            $("#detailHeader").html(MatTypes[dataArray[0].t].name);
            $("#detailEditHeader").html(MatTypes[dataArray[0].t].name);
        }
        //This joins all of the elements in the array into one long string.
        $('#listItemDetailsList').html(detailsListHtml);
        $("#listItemDetailsList").trigger('create');
        $('#listItemDetailsList').listview().listview('refresh');
		
		$('#listEditItemDetails').html(editListHtml);
        $("#listEditItemDetails").trigger('create');
        $('#listEditItemDetails').listview().listview('refresh');
        
        datepickr('.datepicker', { dateFormat: 'd-m-Y'});
		$('.timepicker').timepicker({ 'step': 10, 'timeFormat': 'h.i A' });
        //Neaten the collapsibles
        $('#listItemInventory').collapsible("collapse");
        $('#listItemDetails').collapsible("expand");
        
    }	
	
    function populateInventory(data){
        // add each material to MatPopulatedList
        for (var i in data)
            MatPopulatedList[i] = data[i];

        if (!$.isEmptyObject(data)) {
            var listHtml = ""; // dynamic html for listbox

            for (var i in data) {
                var desc1 = data[i].d[MatDescriptions[data[i].t][0].descId]
                var desc2 = data[i].d[MatDescriptions[data[i].t][1].descId]
                var desc3 = data[i].d[MatDescriptions[data[i].t][2].descId]

                //Create row for each material
                listHtml += "<li><a href='#pageDetail' id='" + i +
                         "' class='listitemMaterials'>";
                listHtml += "<h2>"+desc1+"</h2><p><strong>Material Type: "
                         +MatTypes[data[i].t].name+"</strong></p><p>"+desc2+"</p><p class='ui-li-aside'><strong>"+desc3+"</strong></p>"
                listHtml += "</a></li>";
            }

            $('#listItemInventoryList').html(listHtml);
            $('#listItemInventory').css("display","block");
        } else {
            $('#listItemInventory').css("display","none");
        }
        $('#listItemInventoryList').trigger('create');
        $('#listItemInventoryList').listview().listview('refresh');
        //$(document).on("click", ".listitemMaterials", clickListItemMaterials);
        
    }
    
    function populateSearchFilterList(){
    		//console.log("Populating search filter list");
        var searchPageListHtml = [];
        var searchType = document.getElementById("selectSearchType").value;
        var i = 0;
        
//        //console.log("MatDesc: " + JSON.stringify(MatDescriptions));
        
        for (var descId in MatDescriptions[searchType])
        { 
            var curDesc = MatDescriptions[searchType][descId];
            if (curDesc.t != "list") {
                searchPageListHtml[i] = '<li data-role="fieldcontain"><label for='
                    + '"input' + i + '">' + curDesc.d + '</label><input type="text"'
                    + 'name="input' + i + '"id="input'+i+'" value=""></li>';
            } else { // Create list box
                var curList = MatLists[curDesc.l];
                searchPageListHtml[i] = '<li data-role="fieldcontain"><label for='
                    + '"input' + i + '">' + curDesc.d + '</label><select '
                    + 'name="input' + i + '"id="input' + i + '">';

                for(var j = -1; j < curList.length; j++) {
                    searchPageListHtml[i] += '<option ';
                    if (j == -1) { // Select the first option
                        searchPageListHtml[i] += 'selected="selected" ';
                        searchPageListHtml[i] += 'value="null">Any</option>';
                    } else {
                        searchPageListHtml[i] += 'value="option' + j + '">'
                            + curList[j] + '</option>';
                    }
                }
                searchPageListHtml[i] += '</select></li>';
            }
            i++;
        }
        $('#searchPageList').html(searchPageListHtml);
        $("#searchPageList").trigger('create');
        $('#searchPageList').listview().listview('refresh');
    }

    // ********************************************************
    // **Dynamic Buttons onClick
    // ********************************************************

    function clickListItemMaterials() {
        var iPrid = $(this).attr('id');

        $("#listItemDetailsList").html("<li>Loading...</li>");
        $('#listItemDetailsList').listview().listview('refresh');
        
		//console.log("Grabbing material");
		//As we are only updating one entity, bulkUpdateArray is still used,
		//but the bulkArrayCount is only set to one 
		bulkUpdateArray = [];
		bulkUpdateArrayCount= 1;
		MatPopulatedList[iPrid]['id'] = iPrid;
		//console.log("iPrid: " + iPrid);
		addToBulkUpdateArray(MatPopulatedList[iPrid]);

    }

    // this is called when a list item in browse materials is clicked
    function clickListItemBrowse(){
        var filter = $(this).attr('data-filter');
        var value = $(this).attr('data-value');
        BrowseMaterialFilter[filter] = value;
        prepareBrowsePage();
    }

    // ********************************************************
    // **Database/Server functions 
    // ********************************************************

    function queryServer(fname, query, callback){
    
        var sUrl = "http://matrak.elasticbeanstalk.com/" + fname;
        //var sUrl = "http://127.0.0.1:8888/" + fname;

        query['userid'] = userID;
        query['auth'] = authCode;
        query['cpid'] = cpid;

        var queryString = JSON.stringify(query);   // stringify from object 

        $.ajax({
            url: sUrl,
            type: "POST",
            data: queryString,
            error: function(x, m, s){
                    bNetEnabled = false;
                    console.log("Connectivity error: " + JSON.stringify(x))
            },
            success: function(data){
              var response = JSON.parse(uncompressData(data));
              if (!response.errorCode) {
                  callback(JSON.parse(uncompressData(data)));
              } else {
                  console.log('Error: '+response.errorMessage);
              }
            },
            timeout: 15000 // sets timeout to 10 seconds
        });
    }
    
    
    function dbGetLists(){
		$(".footerText").text("Downloading lists...");
		queryServer('getlists',{},function(data){
			
        	MatLists = data;
        	//console.log("Downloaded lists");
                    	
            if (bUseFileSystem){
            	//console.log("Attempting to save lists");
            	$(".footerText").text("Saving lists...");
            	fSaveToDisk(compressData(JSON.stringify(data)), "lists.txt", fQueueHandler);    //May crash - sending null
            }
            else{
            	fQueueHandler();
            }                   	
        });
    }
    
    function dbGetDescriptions(){
    	$(".footerText").text("Downloading material decriptions...");
    		queryServer('getdescriptions',{},function(data){
			
                    	MatDescriptions = data;
                    	//console.log("Downloaded lists");
                    	
                    if (bUseFileSystem){
                    	$(".footerText").text("Saving material descriptions ...");
                    	//console.log("Attempting to save descs");
                    	fSaveToDisk(compressData(JSON.stringify(data)), "descriptions.txt", fQueueHandler);    //May crash - sending null

                    }
                    else{
                    	//console.log("Can't save descs locally: " + bUseFileSystem);
                    	fQueueHandler();
                    }

                    	
                		});    	
    }
    
    
    function dbGetTypes(){
    	$(".footerText").text("Downloading material types...");
        queryServer('getmaterialtypes',{},function(data){
			
            MatTypes = data;
            //console.log("Downloaded material types");
                    	
            if (bUseFileSystem){
            	$(".footerText").text("Saving material types...");
                //console.log("Attempting to save types");
                fSaveToDisk(compressData(JSON.stringify(data)), "types.txt", fQueueHandler); //May crash - sending null
            } else {
            	fQueueHandler();
                //console.log("Can't save types locally: " + bUseFileSystem);
            }
            
        });    	
    }
    
    
    function dbUpdateMaterials(){
        $(".footerText").text("Downloading materials...");
        
        //console.log("Updating materials!");
        
        if (sFSMatLastUpdated == ""){    //Are we grabbing everything?
            
            //console.log("sFSMatLastUpdated is empty");
            
        		//Grab timestamp
        		
        		//Need to update!!!
        		
        		//queryServer(fname, sQuery, callback)
        		
        		queryServer('getlastupdated',{},function(data){
        			//console.log("getlastupdated worked!!");
//        			data = JSON.parse(data);	
              //console.log("Got timestamp " + data.timestamp);
              
              
              sFSMatLastUpdated = data.timestamp;
        			//Save sFSMatLastUpdated to disk
  
              //console.log("Triggering getallmatdesc!");
              queryServer('getallmaterialdescriptions',{},function(data){
              	$(".footerText").text("Saving materials...");
              	fsIndexNSave(data['items'],function(){
              		console.log("Saved new project " + cpid);
              		var SaveMe = {"cpid":cpid,"sFSMatLastUpdated":sFSMatLastUpdated, "iMatFileCount":iMatFileCount};
									fSaveToDisk(JSON.stringify(SaveMe), "project.txt", fQueueHandler);
									});

              });
        			
        		});
        			
        		//console.log("End of updating materials");
        		
        }
       	else {
       		
       		//console.log("sFSMatLastUpdated is not empty");
          if(!(sFSMatLastUpdated == sDBMatLastUpdated)){
          	//Grab timestamp
       
						var tempFSMatLastUpdated;    //Only updating a temp value, as need the real version to know what to update!

						queryServer('getlastupdated',{},function(data){

    	        tempFSMatLastUpdated = data.timestamp;
      	      var params = {'time':sFSMatLastUpdated};
        		
        			queryServer('getmatdescriptions',params,function(data){
        			
	        			//console.log("Received materials from " + sFSMatLastUpdated);
  	        		//console.log(JSON.stringify(data));
  	        		
  	        		
  	        		bLocalReady = false;
           			fsUpdateMatRecord(data['items']);
           			sFSMatLastUpdated = tempFSMatLastUpdated;
           			
           			//******************** Need to move
           		  UpdateQueue.push(function(){
			          	var SaveMe = {"cpid":cpid,"sFSMatLastUpdated":sFSMatLastUpdated, "iMatFileCount":iMatFileCount};
  	        			//console.log("Saving " + JSON.stringify(sTimes));
    	      			fSaveToDisk(JSON.stringify(SaveMe), "project.txt", fQueueHandler);
    	      		});
    	      		UpdateQueue.push(SetbLocalReady);
    	      			
        			});
           	});
          }
          
          fQueueHandler();
       }
    }

    // ********************************************************
    // **AJAX queue handler
    // ********************************************************

    // * This code is so that when you have a queue of ajax functions that need calling (i.e. when check local delivery timestamp, check db timestamp,       *
    // * download entities from that time, save deliveries, create an index, check local materials timestamp etc etc. We keep an array of all the            *
    // * functions that need to be called in order. At the end of each ajax thread, it calls fQueueHandler which runs the function at the top, and deletes   *
    // * it from the queue. Then that function goes on its merry way, and at the end, calls fQueueHandler to do it all again.                                *
    // *                                                                                                                                                     *



    function fQueueHandler(){

        //Currently only handles UpdateQueue...not sure how to cleanly pass both the array *and* the function through the ajax thread

        if (UpdateQueue.length > 0){

            tempFunc = UpdateQueue[0]; //For safety! Prevents infinite loops.

            ////console.log("Running function: " + tempFunc);
            //Remove the top record from the queue
            UpdateQueue.splice(0,1);
            tempFunc(); //Run whatever was previously at the top of the queue

        }
        else{
            console.log("Queue empty!");
        }

    }

    function SetbLocalReady(){
        //Does what it says on the tin..
        bLocalReady = true;
        //console.log("bLocalReady set to " + bLocalReady);
        $(".footerText").text("Update complete");
        fQueueHandler();
    }



    // ********************************************************
    // **Device FileSystem functions
    // ********************************************************

function fsIndexNSave(MatData,funcName){
	//MatData is an object
	if (typeof(MatData) != 'undefined') {
      if (Object.keys(MatData).length == 0){
          ////console.log("Error: Not MatData to index!");
      }
  } else {
      //console.log("Error: No MatData to index!")
  }
	//console.log("fsIndexNSave");

	//Need to add code where it determines how many records to put in each index,
	//rather than just having 1 file with everything in it. 
	
	
	
	
	
	MatIndex = new Array();
	var iFileNo = -1;	//Ensure iFileNo finishes loop with correct amount
	var iloop = 0;
	var tmpIndex = new Array();
	tmpIndex = Object.keys(MatData);
	
	while (iloop < tmpIndex.length){
		iFileNo++;
		MatIndex[iFileNo] = tmpIndex.slice(iloop,(iloop+C_NUM_RECORD_FS_FILES));
		iloop = iloop + C_NUM_RECORD_FS_FILES;
	}
	
	iMatFileCount = iFileNo;		//Need to save iMatFileCount to project.txt
	
	//console.log("Loop log 1: " + iloop);
	
	//MatIndex[iFileNo] = Object.keys(MatData);
	
	//console.log("Index: " + JSON.stringify(MatIndex));

	fSaveToDisk(compressData(JSON.stringify(MatIndex)), "matIndex.txt", fQueueHandler)	//fQueueHandler();	
	
	//console.log("Saving Mat Data!");
	
	
	//console.log("iFileNo: " + iFileNo + " MatIndex Soze" + MatIndex.length);
	
	//Reset the loop, so you can use the same logic to save the same records to disk
	iloop = 0;
	
	
	$.each(MatIndex, function(i,tmptmpIndex){
		var tmpMatData = {}; //This is filled with the mat data for a given record, based on what's in the index
		
		$.each(tmptmpIndex, function(j,tmpRecordID){
			tmpMatData[tmpRecordID] = MatData[tmpRecordID];
		});
		
		fSaveToDisk(compressData(JSON.stringify(tmpMatData)), "mat" + i + ".txt", null);
		//console.log("Saving " + i);
		iloop = iloop + C_NUM_RECORD_FS_FILES;
	});
	
	//console.log("Loop log 2: " + iloop);
	
	var SaveMe = {"sFSMatLastUpdated":sFSMatLastUpdated, "iMatFileCount":iMatFileCount};
 	//console.log("Saving " + JSON.stringify(SaveMe));
  fSaveToDisk(JSON.stringify(SaveMe), "project.txt", null);    //May crash - sending null
	
	funcName();
			
}



function fsGetMaterials(startrec, sfilter, funcName){


    // Steps:
    // 1. Take turns decompressing files & loading then into Ram
    // 2. Load suitable records into a new output array. This gets passed to
    //    the next function.
    
    
    var iFileNo = 0;
    
    console.log("Getting material info according with the filter " + JSON.stringify(sfilter));
    
    var iCountRecords = 0;
    var bFinishedSearch = false;
    CurRecords = {};
    
    //fSearchMaterials is a recursive function, that calls itself
    //until it either runs out of files in the file system, or finds
    //the right number of results.
    fSearchMaterials();
        
    function fSearchMaterials(){
    	
    	sFileName = "mat" + iFileNo + ".txt"
    	console.log("File: " + sFileName + " Count " + iCountRecords);
    	
    	
    	    		
			window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);
    	
    	function gotFS(fileSystem) {
    	    console.log("Got filesystem");
    	    fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    	}
    	
    	function gotDir(dirEntry){
    	    console.log("Got Directory!!!");
    	    dirEntry.getFile(sFileName, {create: false, exclusive: false},
    	            gotFileEntry, fail);
    	}
    	
    	
    	function gotFileEntry(fileEntry) {
    	    console.log("Got file entry!");
    	    fileEntry.file(gotFile, fail);
    	}
    	
    	function gotFile(file){
    	    console.log("Got file!");
    	    readAsText(file);
    	}
    	
    	function readAsText(file) {
    	    console.log("Reading file!");
    	    var reader = new FileReader();
    	    reader.onloadend = function (evt){
    	        //console.log("Reading finished");
    	        ////console.log(evt.target.result);
    	
    	        //this is setting which function gets called when
    	        //reader.readAsText completes
    	        fApplyFilter(evt);
    			};
    	
    	    reader.readAsText(file);
    	}
    	
    	function fail(evt) {
    	    //console.log(evt.target.error.code);
    	}
    	
    	function fApplyFilter(evt){
													
    	    var MatTempObj = JSON.parse(uncompressData(evt.target.result)); //result = data read in readAsText
    	    //console.log("Number records: " + MatTempObj.length);
					tmpkey = new Array();
					tmpkey = Object.keys(MatTempObj);
					
					
					$.each(MatTempObj, function(i, tmpMat){
						
						if ((!(iCountRecords > (startrec + C_NUM_PAGE_RECORDS))) && (!(iCountRecords < (startrec - 1)))) {
							
							var bMatch = false;
							
							$.each(tmpMat,function(j,tmpDesc){
								
								if(sfilter['filter'].length > 0){
									
									var iFieldMatch = 0;
																	
									$.each(sfilter['filter'],function(k,tmpfil){
							  	
										if((tmpDesc['i'] == tmpfil['field']) && ((tmpDesc['v'] == tmpfil['value']))){
											iFieldMatch++;
											if(iFieldMatch == sfilter['filter'].length){
												bMatch = true;
												return false;
											}
										}
									});
									
								}
								else
								{							
									if(tmpDesc['i'] == MatDescriptions[sfilter['material_type_id']][0].descId){
										//for this it's easier to set true from a non-match
										bMatch = true;
									}
								}						
								
								if (bMatch == true){
    	
									var tmptmptmp = {};
									
									tmptmptmp['t'] = parseInt(sfilter['material_type_id']);
									tmptmptmp['d'] = {};
									
									
									$.each(tmpMat,function(l,tmpMatDesc){
										tmptmptmp['d'][tmpMatDesc.i] = tmpMatDesc.v;
									});
									
									console.log("Caught one: " + i);
									
									CurRecords[i] = {};
									CurRecords[i] = tmptmptmp;
									
									iCountRecords++;
									return false;
								}	
									
							});
						}
					});
					
				//Finished running searching this particular file
				
				if ((iCountRecords < (startrec + C_NUM_PAGE_RECORDS)) && (bFinishedSearch == false)){
					iFileNo++;
					fSearchMaterials();
    			if (iFileNo==iMatFileCount){bFinishedSearch = true;}
    		}
    		else
    		{
    			
    
    			console.log("Exited! bFinishedSearch = " + bFinishedSearch);
    			console.log(JSON.stringify(CurRecords));
    
    			funcName(CurRecords);
  			}


    	}
    } 
	}

function fsGetChildren(startrec, prid, funcName){
    //Currently this function does not check the available RAM vs. size of the 
    //delivery file, before attempting to read the whole fricking thing. 
    //This is bad! But hopefully should be fairly straightforward to remedy..
    // at init just trigger 
    
    // Steps:
    // 1. With the filter, swap out the field names for the class prids.
    // 2. Load del.txt into memory Note: There should be an ability to run this
    //    iteratively if filesize > available RAM
    // 3. Use the index information to grab/parse one entity at a time. Load it
    //    into an array, and compare it against the sfilter and startrec
    // 4. Load suitable records into a new output array. This gets passed to
    //    the next function.
    
    //console.log("Getting children of prid: " + prid);
    
    //Ensure classes populated correctly
    if (typeof(Classes) != 'undefined') {
        if (Object.keys(Classes).length == 0){
            //console.log("Error: Classes not populated!");
        }
    } else {
        //console.log("WTF! Classes undefined!")
    }

    // Duplicating this functionality sucks ballsacks, but unfortunately the
    // only other option seems to be splitting the function into 2 (one function
    // for before the file read, one for after that gets called post ajax). That
    // seems riskier in terms of error handling, and godawful to keep track of
    // that number of split functions,so, endless duplication of the same
    // fricking functions it is!

    //console.log("Attempting to access file system");
    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

    function gotFS(fileSystem) {
        //console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }

    function gotDir(dirEntry){
        //console.log("Got Directory!!!");
        dirEntry.getFile("mat.txt", {create: false, exclusive: false},
                         gotFileEntry, fail);
    }

    function gotFileEntry(fileEntry) {
        //console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
        //console.log("Got file!");
        readAsText(file);
    }

    function readAsText(file) {
        //console.log("Reading file!");
        var reader = new FileReader();
        reader.onloadend = function (evt){
            //console.log("Reading finished");
            ////console.log(evt.target.result);

            //this is setting which function gets called when
            //reader.readAsText completes
            fApplyFilter(evt);

            //Here's where, if it were only reading subsets of the file,
            //it'd do some magic to work out how many results had been
            //found (and therefore if it needed to keep searching), plus
            //check how far through the file it's gotten, before deciding
            //if it wants to trigger readAsText(file) again on a new subset
            //of the file.
        };

        //Here's the part where you should check the available amount of
        //RAM, and read *subsets* of the file
        reader.readAsText(file);
    }

    function fail(evt) {
        //console.log(evt.target.error.code);
    }

    function fApplyFilter(evt){
        // Note: If you're splitting files up before reading them, you'll also
        // need to add something here so it knows what the starting character
        // of strline is relative to mat.txt

        //Here's where it runs through the index, checks the results against
        //the filter, counts a certain number of results
        var strline = evt.target.result; //result = data read in readAsText
        ////console.log("Read data: " + strline);

        //Clear any records that may already exist (not sure if this is the
        //best spot for this functionality)
        console.log("Danger, danger!");
        CurRecords = [];
        $.each(MatIndex, function(i, mati) {
            var tmpMat = [];

            //Grab a record, load it into the array!
            tmpMat = JSON.parse(strline.substr(parseInt(mati.start),
                                parseInt(mati.len)));

            ////console.log(JSON.stringify(tmpMat));
            if (tmpMat.parent == prid){
                CurRecords.push(tmpMat); //If the record matched save it to the list
                ////console.log("Added to CurRecords: " + tmpMat['primary_id']);
            }

        });

        ////console.log("Total records selected: " + CurRecords.length);

        // You need to add a (gosdarnit) function to convert the prid/value
        // pairs into actual fieldname+value pairs. There's a bunch of stuff
        // like Status that you've gotta reference all over the shop, and
        // you're not going to want to have to look it up every time obviously.
        // This is done in fPridToFields

        //Set up data ready to send to populateDeliveriesList
        var data = [];
        data = {'output':CurRecords};

        ////console.log("Created data: " + JSON.stringify(data));
        ////console.log("Converting to fields!");

        var tmp = fPridToFields(data);
        ////console.log("Sending to next function: " + JSON.stringify(tmp));
        ////console.log("Calling function");
        funcName(tmp);
    }
}

function fSaveToDisk(data, sFilename, funcName){

		var tempdata = data;
		var tempfuncName = funcName;
		//console.log("Trying to save " + sFilename);

    //console.log("Attempting to access file system");
    window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);


    function gotFS(fileSystem) {
    		//console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: true}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			//console.log("Got Directory!!!");
			dirEntry.getFile(sFilename, {create: true, exclusive: false}, gotFileEntry, fail);
		}
		
    function gotFileEntry(fileEntry) {
    	//console.log("Got frickin file!");
      fileEntry.createWriter(gotFileWriter, fail);
    }

    function gotFileWriter(writer) {
    	
    	//Creates function that triggers when write finishes.
        writer.onwriteend = function(evt) {
            console.log("Data now written to " + sFilename);
            
            if (tempfuncName !== null){
            	//console.log("Finished writing, calling function " + tempfuncName);
            	tempfuncName();
            }else{
            	console.log("Data written but no other function...The end!");
            }

        };
        
        //Writes 
        writer.write(tempdata);
    }

    function fail(error) {
        //console.log("Failed to save " + sFilename + " err: " + error.code);
    }

}



function fsUpdateMatRecord(data){
	
	$(".footerText").text("Saving updated materials...");
	
	
	/*
	How this function works:
	
	- For each number in the index, are any of the updated records there?
	-- If so, open that file, load the records into memory, update the selected record, save the file.
	--- Delete this record from the "to be updated" list
	-- If not, and you're at iMatCount, then see if the final file has max number of records.
	--- If not, add this to the file, add it to the index, and save the index again
	--- If not, create a new file, and save the index again.
		
	*/
	
	var NewMatData = data;
	
	$.each(MatIndex, function(i, tmpIndex){
		
		var MatUpdateInFile = {};
		
		$.each(Object.keys(NewMatData), function(j, RecordID){
			$.each(tmpIndex, function(k,tmpIndexRecord){
				
				if(RecordID == tmpIndexRecord){
					MatUpdateInFile[RecordID] = NewMatData[RecordID];
					delete NewMatData[RecordID];
					return false;
				}
				
			});		
		});
		
		if (!($.isEmptyObject(MatUpdateInFile))){
			//We've found some records for the 1st file! Time to send them to fUpdateRecord!
			fUpdateRecord("mat" + i + ".txt",MatUpdateInFile);
		}	
	});
	
	//Now we've run out of records in the index...is there anything left
	//to save?
	
	if (!($.isEmptyObject(NewMatData))){
		console.log("New records need to be save3d! Error!");
		
	}



	function fUpdateRecord(sFileName, NewData){
  	
  	
  	window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);
		console.log("!!");
		
		
		function gotFS(fileSystem) {
    		console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			console.log("Got Directory!!!");
			dirEntry.getFile(sFileName, {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
			var reader = new FileReader();
						reader.onloadend = function (evt){
							console.log("Read " + evt.target.result);
							fMergeOldNew(uncompressData(evt.target.result));
							};		
							
			reader.readAsText(file);
		}
		
		function fMergeOldNew(sOldData){
			console.log("fMergeOldNew started");
			
			var MatOldData = {};
			console.log(sOldData);
			MatOldData = JSON.parse(sOldData);
			console.log("2");
			$.each(NewData, function(i,UpdateRecord){
				console.log("zubzub " + JSON.stringify(UpdateRecord));
				console.log("wub " + i);
				console.log("!! " + Object.keys(NewData))			
				
				console.log("Hurdurp" + JSON.stringify(MatOldData[i]));
				MatOldData[i] = UpdateRecord;
			});
			console.log("werb " + JSON.stringify(MatOldData));
			fSaveToDisk(compressData(JSON.stringify(MatOldData)), sFileName, fQueueHandler)
		}		
		
		function fail(evt) {
        //console.log(evt.target.error.code);
    }
  }
}

function fsGetLastUpdates(){
	
	////console.log("Attempting to access file system");
  window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

		function gotFS(fileSystem) {
    		////console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			////console.log("Got Directory!!!");
			dirEntry.getFile("project.txt", {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	////console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
    	////console.log("Got file!");    	
					
			var reader = new FileReader();
						reader.onloadend = function (evt){
							////console.log("Read " + evt.target.result);
							fLoadLastUpdate(evt.target.result);
							};		
							
			//FUCKIT. We're just reading everything
			////console.log("Reading file");							
			reader.readAsText(file);
		}
		
		function fLoadLastUpdate(data){
			data = JSON.parse(data);
			////console.log(JSON.stringify(data));
			
			if (cpid == data.cpid){
				console.log("FS: " + data.cpid + " DB: " + cpid);
				sFSMatLastUpdated = data.sFSMatLastUpdated; //String - last time filesystem was updated
				iMatFileCount = data.iMatFileCount;	//Reads number of local materials files
			}
			else{
				console.log("FS: " + data.cpid + " DB: " + cpid);
				iMatFileCount = 0;
				sFSMatLastUpdated = "";
        fQueueHandler();
			}
			
			
			
			fQueueHandler();
		}
		
		function fail(evt) {
        //console.log("Can't find project.txt, setting MatLastUpdated to ''"); // + evt.target.error.code); //was bugging out on evt.target.error.code, undefined variable
        sFSMatLastUpdated = "";
        fQueueHandler();
        
        if (bNetEnabled==false){
        	alert("Can't connect to network! Please try again later.");
        	$.mobile.changePage("#pageLogin");
      	}
    }
	
}


function fsLoadTypes(){
	

	$(".footerText").text("Loading saved Material Type info...");
	////console.log("Attempting to access file system");
  window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

		function gotFS(fileSystem) {
    		////console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			////console.log("Got Directory!!!");
			dirEntry.getFile("types.txt", {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	////console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
    	////console.log("Got file!");    	
					
			var reader = new FileReader();
						reader.onloadend = function (evt){
							////console.log("Got class info");
							fLoadTypes(evt.target.result);
							};		
							
			//FUCKIT. We're just reading everything
			////console.log("Reading file");							
			reader.readAsText(file);
		}
		
		function fLoadTypes(data){
			MatTypes = JSON.parse(uncompressData(data));
			
			fQueueHandler();
		}
		
		function fail(evt) {
        //console.log(evt.target.error.code);
    }
	
}

function fsLoadLists(){
	
	$(".footerText").text("Loading saved lists...");
	////console.log("Attempting to access file system");
  window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

		function gotFS(fileSystem) {
    		////console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			////console.log("Got Directory!!!");
			dirEntry.getFile("lists.txt", {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	////console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
    	////console.log("Got file!");    	
					
			var reader = new FileReader();
						reader.onloadend = function (evt){
							////console.log("Read " + evt.target.result);
							fLoadLists(evt.target.result);
							};		
							
			//FUCKIT. We're just reading everything
			////console.log("Reading file");							
			reader.readAsText(file);
		}
		
		function fLoadLists(data){
			MatLists = JSON.parse(uncompressData(data));
            // need to replace this with new server
            //populateLists(data);
			//console.log("Hopefully correct lists..." + JSON.stringify(Lists));
			////console.log("done!!");
			fQueueHandler();
		}

		
		function fail(evt) {
        //console.log(evt.target.error.code);
    }
	
}

function fsLoadDescriptions(){
	
	$(".footerText").text("Loading saved descriptions...");
	////console.log("Attempting to access file system");
  window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

		function gotFS(fileSystem) {
    		////console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			////console.log("Got Directory!!!");
			dirEntry.getFile("descriptions.txt", {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	////console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
    	////console.log("Got file!");    	
					
			var reader = new FileReader();
						reader.onloadend = function (evt){
							////console.log("Read " + evt.target.result);
							fLoadDescriptions(evt.target.result);
							};		
							
			//FUCKIT. We're just reading everything
			////console.log("Reading file");							
			reader.readAsText(file);
		}
		
		function fLoadDescriptions(data){
			MatDescriptions = JSON.parse(uncompressData(data));
			$(".footerText").text("Descriptions loaded");
			fQueueHandler();
		}

		
		function fail(evt) {
        //console.log(evt.target.error.code);
    }
	
}


function fsLoadMatIndex(){
	
	$(".footerText").text("Loading saved materials index...");
	////console.log("Attempting to access file system");
  window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, gotFS, fail);

		function gotFS(fileSystem) {
    		////console.log("Got filesystem");
        fileSystem.root.getDirectory(C_APPDIR, {create: false}, gotDir, fail);
    }
		
		function gotDir(dirEntry){
			////console.log("Got Directory!!!");
			dirEntry.getFile("matIndex.txt", {create: false, exclusive: false}, gotFileEntry, fail);
		}


    function gotFileEntry(fileEntry) {
    	////console.log("Got file entry!");
        fileEntry.file(gotFile, fail);
    }

    function gotFile(file){
    	////console.log("Got file!");    	
					
			var reader = new FileReader();
						reader.onloadend = function (evt){
							////console.log("Read " + evt.target.result);
							fLoadMatIndex(uncompressData(evt.target.result));
							};		
							
			//FUCKIT. We're just reading everything
			////console.log("Reading file");							
			reader.readAsText(file);
		}
		
		function fLoadMatIndex(data){
			MatIndex = JSON.parse(data);
			fQueueHandler();
		}

		
		function fail(evt) {
        //console.log(evt.target.error.code);
    }
	
}

});		//End of code!
