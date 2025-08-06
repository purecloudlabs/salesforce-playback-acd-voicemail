# ACD Voicemail Salesforce Deployment Guide

## Table of Contents
- [Prerequisites](#prerequisites)
- [Deployment Steps](#deployment-steps)
- [VS Code Deployment (Using Salesforce Extension Pack)](#vs-code-deployment-using-salesforce-extension-pack)
- [Project Components](#project-components)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Troubleshooting](#troubleshooting)
- [Environment-Specific Deployments](#environment-specific-deployments)
- [Best Practices](#best-practices)
- [Quick Deploy Script](#quick-deploy-script)
- [Support](#support)
- [References](#references)

## Prerequisites

### 1. Software Requirements
- **Salesforce CLI** (latest version)
  ```bash
  npm install -g @salesforce/cli
  ```
- **Node.js** (version 18 or higher)
- **Git** (for version control)
- **VS Code** with Salesforce Extension Pack (recommended)

### 2. Salesforce Environment
- Access to a Salesforce org (Production, Sandbox, or Developer Edition)
- System Administrator permissions
- API access enabled

### 3. Verify CLI Installation
```bash
sf --version
```

## Deployment Steps

### Step 1: Authenticate with Your Salesforce Org

#### For Production/Developer Edition:
```bash
sf org login web --alias prodOrg
```

#### For Sandbox:
```bash
sf org login web --alias sandboxOrg --instance-url https://test.salesforce.com
```

#### Verify Authentication:
```bash
sf org list
```

### Step 2: Set Default Org (Optional)
```bash
sf config set target-org prodOrg
```

### Step 3: Validate Deployment (Recommended)
Before deploying, validate your metadata:

```bash
sf project deploy validate --source-dir force-app
```

### Step 4: Deploy to Salesforce

#### Option A: Deploy All Metadata
```bash
sf project deploy start --source-dir force-app
```

#### Option B: Deploy Specific Components
```bash
# Deploy only LWC components
sf project deploy start --source-dir force-app/main/default/lwc

# Deploy only static resources
sf project deploy start --source-dir force-app/main/default/staticresources
```

### Step 5: Verify Deployment
```bash
sf project deploy report
```

## VS Code Deployment (Using Salesforce Extension Pack)

### Prerequisites for VS Code Deployment
1. **Install Salesforce Extension Pack**:
   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X)
   - Search for "Salesforce Extension Pack"
   - Install the official extension by Salesforce

2. **Open Project in VS Code**:
   ```bash
   code .
   ```

### VS Code Deployment Steps

#### Step 1: Authorize Org in VS Code
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `SFDX: Authorize an Org`
3. Select your org type:
   - **Production/Developer**: Select "Production"
   - **Sandbox**: Select "Sandbox"
4. Enter org alias (e.g., `vscodeOrg`)
5. Complete authentication in browser

#### Step 2: Set Default Org
1. Command Palette (`Ctrl+Shift+P`)
2. Type: `SFDX: Set a Default Org`
3. Select your authorized org

#### Step 3: Deploy Using VS Code

**Option A: Deploy Entire Project**
1. Right-click on `force-app` folder
2. Select `SFDX: Deploy Source to Org`

**Option B: Deploy Specific Components**
1. Right-click on specific file/folder (e.g., `lwc/acdVoicemailViewer`)
2. Select `SFDX: Deploy Source to Org`

**Option C: Deploy from Explorer**
1. Select files in Explorer
2. Right-click → `SFDX: Deploy Source to Org`

#### Step 4: Monitor Deployment
- Check **Output** panel (View → Output)
- Select "Salesforce CLI" from dropdown
- Monitor deployment progress and results

### VS Code Useful Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `SFDX: Deploy Source to Org` | - | Deploy selected metadata |
| `SFDX: Retrieve Source from Org` | - | Pull changes from org |
| `SFDX: Create Lightning Web Component` | - | Generate new LWC |
| `SFDX: Execute Anonymous Apex` | `Ctrl+Shift+P` | Run Apex code |
| `SFDX: Open Default Org` | - | Open org in browser |

### VS Code Status Bar
- **Bottom-left corner** shows current default org
- **Click org name** to switch between authorized orgs
- **Green checkmark** indicates successful connection

## Project Components

This project includes:
- **Lightning Web Component**: `acdVoicemailViewer`
- **Static Resource**: `GenesysAuthCallback.html`
- **Metadata**: Applications, layouts, permission sets, tabs, etc.

## Post-Deployment Configuration

### 1. Assign Permission Sets
Navigate to Setup → Users → Permission Sets and assign relevant permissions to users.

### 2. Configure App Settings
- Go to App Launcher → ACD Voicemail (if application is included)
- Configure any custom settings or metadata

### 3. Test Components
- Navigate to the Lightning App Builder
- Add the `acdVoicemailViewer` component to a page
- Test functionality

## Troubleshooting

### Common Issues:

#### Authentication Error
```
No authorization information found for [orgAlias]
```
**Solution**: Re-authenticate using `sf org login web --alias [orgAlias]`

#### Deployment Failures
**Check deployment status**:
```bash
sf project deploy report --job-id [deployment-id]
```

#### Component Conflicts
**Solution**: Use `--ignore-conflicts` flag (use with caution):
```bash
sf project deploy start --source-dir force-app --ignore-conflicts
```

### Rollback Deployment
If you need to rollback:
1. Use Salesforce Setup → Deployment Status
2. Find your deployment and click "Quick Deploy" on a previous successful deployment

## Environment-Specific Deployments

### Development to Staging
```bash
sf org login web --alias staging --instance-url https://test.salesforce.com
sf project deploy start --source-dir force-app --target-org staging
```

### Staging to Production
```bash
sf org login web --alias production
sf project deploy validate --source-dir force-app --target-org production
sf project deploy start --source-dir force-app --target-org production
```

## Best Practices

1. **Always validate before deploying to production**
2. **Use version control** - commit changes before deployment
3. **Test in sandbox first**
4. **Deploy during maintenance windows**
5. **Keep deployment logs** for troubleshooting
6. **Use change sets** for complex deployments across multiple orgs

## Quick Deploy Script

For convenience, you can use the included `deploy.bat` file:
```bash
deploy.bat
```

## Support

For deployment issues:
1. Check Salesforce Setup → Deployment Status
2. Review deployment logs
3. Verify user permissions
4. Check component dependencies

## References

### Official Salesforce Documentation
- [Salesforce CLI Setup Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference.htm)
- [Lightning Web Components Developer Guide](https://developer.salesforce.com/docs/component-library/documentation/en/lwc)

### VS Code Extensions
- [Salesforce Extension Pack](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode)
- [Salesforce Extensions Documentation](https://developer.salesforce.com/tools/vscode/)

---

**Note**: This project is configured for sandbox deployment by default (see `sfdx-project.json`). Update the `sfdcLoginUrl` if deploying to production.