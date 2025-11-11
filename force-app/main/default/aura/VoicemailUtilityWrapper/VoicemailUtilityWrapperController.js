({
    handleVoicemailCount: function (component, event, helper) {
        var count = event.getParam('count');
        var utilityAPI = component.find("utilityBar");
        var label = count > 0 ? 'Voicemail (' + count + ')' : 'Voicemail';

        utilityAPI.setUtilityLabel({ label: label });
        utilityAPI.setUtilityHighlighted({ highlighted: count > 0 });
    }
})
