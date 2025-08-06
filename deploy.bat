@echo off
echo ===== Deploying ACD Voicemail Viewer LWC to Salesforce =====

REM Step 1: Authenticate to your Salesforce org (if not already authenticated)
echo Step 1: Authenticating to Salesforce org...
echo Please follow the browser prompts to log in to your Salesforce org.
sf org login web

REM Step 2: Deploy the Lightning Web Component
echo Step 2: Deploying the Lightning Web Component...
sf project deploy start --source-dir force-app

echo ===== Deployment Complete =====
echo If successful, you can now add the ACD Voicemail Viewer component to Voice Call record pages in Lightning App Builder.
pause