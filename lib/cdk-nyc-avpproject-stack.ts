import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as verifiedpermissions from 'aws-cdk-lib/aws-verifiedpermissions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { AgentActionGroup } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock';
import * as path from "path";
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';



// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CdkNycAvpprojectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1: S3 Bucket for Frontend Hosting
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFront Distribution with OAI
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for CloudFront access to S3 bucket',
    });

    // Grant the OAI read permissions to the S3 bucket
    frontendBucket.grantRead(originAccessIdentity);

    // Step 2: CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
       defaultRootObject: 'index.html', // Specify index.html as the default root object
    });

    const frontendDomain = `https://${distribution.domainName}`; // Assuming you're using CloudFront's domain for the frontend.

    // Step 3: Cognito User Pool and Group for Authentication
    const autoConfirmUserLambda = new lambda.Function(this, 'AutoConfirmUserLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./confirm'), // Directory containing your Lambda code
    });

    const addToGroupLambdaRole = new iam.Role(this, 'AddToGroupLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        // iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });
    
    // // Add permission to allow the Lambda to add users to Cognito groups
    // addToGroupLambdaRole.addToPolicy(
    //   new iam.PolicyStatement({
    //     effect: iam.Effect.ALLOW,
    //     actions: ['cognito-idp:AdminAddUserToGroup'],
    //     resources: [
    //       `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
    //     ],
    //   })
    // );

    const autoUserToGroupLambda = new lambda.Function(this, 'AutoUserToGroupLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      role: addToGroupLambdaRole, 
      code: lambda.Code.fromAsset('./addtogroup'), // Directory containing your Lambda code
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true, // Enable self-sign-up
      signInAliases: { email: true },
      autoVerify: { email: true }, // Disable automatic email verification
      customAttributes: {
        lob: new cognito.StringAttribute({ mutable: true }),
        region: new cognito.StringAttribute({ mutable: true })
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY, // Allow password recovery via email
      lambdaTriggers: {
        preSignUp: autoConfirmUserLambda,
        postConfirmation: autoUserToGroupLambda
      },
    });


    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true, // Enable username/password authentication
        userSrp: true, // Enable Secure Remote Password (SRP) protocol
      },
      preventUserExistenceErrors: true,
      oAuth: {
        callbackUrls: [`${frontendDomain}`], // URL to redirect after a successful login
        logoutUrls: [`${frontendDomain}/logout`], // URL to redirect after logout
      },
    });

    const juniorAnalystGroup = new cognito.CfnUserPoolGroup(this, 'JuniorAnalystGroup', {
      groupName: 'JuniorAnalystGroup',
      userPoolId: userPool.userPoolId,
    });

    const seniorAnalystGroup = new cognito.CfnUserPoolGroup(this, 'SeniorAnalystGroup', {
      groupName: 'SeniorAnalystGroup',
      userPoolId: userPool.userPoolId,
    });

    const complianceOfficersGroup = new cognito.CfnUserPoolGroup(this, 'ComplianceOfficerGroup', {
      groupName: 'ComplianceOfficerGroup',
      userPoolId: userPool.userPoolId,
    });

    const portfolioManagerGroup = new cognito.CfnUserPoolGroup(this, 'PortfolioManagerGroup', {
      groupName: 'PortfolioManagerGroup',
      userPoolId: userPool.userPoolId,
    });

    // Step 4: Verified Permissions Policy Store
    const policyStore = new verifiedpermissions.CfnPolicyStore(this, 'PolicyStore', {
      description: 'Policy store for invoking lambda resources',
      validationSettings: {
        mode: 'STRICT',
      },
      schema: {
        cedarJson: JSON.stringify({
          ChatApplication: {
            entityTypes: {
                Group: {
                  shape: {
                    type: 'Record',
                    attributes: {},
                  },
                },
                User: {
                  memberOfTypes: ['Group'],
                  shape: {
                      type: 'Record',
                      attributes: {
                        custom: {
                          type: 'Record',
                          attributes:{
                            lob: {
                              type: 'String'
                            },
                            region: {
                              type: 'String'
                            }
                          }
                        }
                      },
                  },
                },
                Document: {
                  shape: {
                    type: 'Record',
                    attributes: {
                      lineOfBusiness:{
                        type: "String"
                      },
                      region:{
                        type: "String"
                      }
                    },
                  },
                  memberOfTypes: []
                },
            },
            actions: {
              View: {
                memberOf: [],
                appliesTo: {
                  principalTypes: ['User'],
                  resourceTypes: ['Document'],
                  context: {
                    attributes: {},
                    type: 'Record',
                  }
                }
              }
            }
          }
        })
      }
    });

    // Cedar policy definition
    const cedarPolicySeniorAnalyst = `
      permit (
          principal in
              ChatApplication::Group::"${userPool.userPoolId}|SeniorAnalystGroup",
          action in [ChatApplication::Action::"View"],
          resource
      )
      when
      {
        resource.lineOfBusiness == "Investments"  && resource.region == "EMEA"
      };
    `;


    new verifiedpermissions.CfnPolicy(this, 'SeniorAnalystPolicy', {
      policyStoreId: policyStore.attrPolicyStoreId,
      definition: {
        static: {
          statement: cedarPolicySeniorAnalyst,
        },
      },
    });

    // Cedar policy definition
    const cedarPolicyJuniorAnalyst = `
    permit (
        principal in
            ChatApplication::Group::"${userPool.userPoolId}|JuniorAnalystGroup",
        action in [ChatApplication::Action::"View"],
        resource
    )
    when
    {
      resource.lineOfBusiness == "Investments"  && resource.region == "APAC" 
    };
  `;


  new verifiedpermissions.CfnPolicy(this, 'JuniorAnalystPolicy', {
    policyStoreId: policyStore.attrPolicyStoreId,
    definition: {
      static: {
        statement: cedarPolicyJuniorAnalyst,
      },
    },
  });

    // Step 5: Lambda Function for Backend
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    
    // Attach the basic execution role (managed policy)
    lambdaRole.addManagedPolicy(
      // iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
    );
    
    // Explicitly define an inline policy
    const verifiedPermissionsPolicy = new iam.Policy(this, 'VerifiedPermissionsPolicy', {
      policyName: `${cdk.Stack.of(this).stackName}-VerifiedPermissionsPolicy`,
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["verifiedpermissions:*"],
        resources: ["arn:aws:verifiedpermissions::*:policy-store/*"]
        }),
      ],
    });

    // Attach the inline policy to the role
    lambdaRole.attachInlinePolicy(verifiedPermissionsPolicy);
    
    // Step TBD: Connect Cognito as Identity Source with Group Configuration
    new verifiedpermissions.CfnIdentitySource(this, 'CognitoIdentitySource', {
      policyStoreId: policyStore.attrPolicyStoreId,
      principalEntityType: 'ChatApplication::User',
      configuration: {
        cognitoUserPoolConfiguration: {
          userPoolArn: userPool.userPoolArn,
          groupConfiguration: {
            groupEntityType: 'ChatApplication::Group', // This maps cognito:groups to ChatApplication::Group
          },
        },
      },
    });


    // Step 7: Deploy Frontend
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset('./frontend')],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Step 8:  Bedrock 
    const accesslogBucket = new s3.Bucket(this, 'AccessLogs', {
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const docBucket = new s3.Bucket(this, 'DocBucket', {
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: accesslogBucket,
      serverAccessLogsPrefix: 'inputsAssetsBucketLogs/',
    });

    const kb = new bedrock.VectorKnowledgeBase(this, 'KB', {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      instruction: 'Use this knowledge base to answer financial questions. ' +
        'It contains the full text of financial documents',
    });

    const dataSource = new bedrock.S3DataSource(this, 'DataSource', {
      bucket: docBucket,
      knowledgeBase: kb,
      dataSourceName: 'financedocs',
      chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
        maxTokens: 500,
        overlapPercentage: 20
      }),
    });

    const agent = new bedrock.Agent(this, 'Agent', {
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_3_5_HAIKU_V1_0,
      instruction: 
`You are “FinMarkets-Assist”, an AI agent serving a research & compliance portal.
Inputs supplied to you at every call
  • role            = {junioranalyst | senioranalyst | portfoliomanager | complianceofficer}
  • region          = {Americas | EMEA | APAC | Global}
  • allowedLobs     = one-or-many of {Investments, MarketResearch, Compliance}
  • userQuestion    = the natural-language question typed by the user
=== You MUST follow trhe following response-fidelity rules ===
1. For JuniorAnalystGroup
   • Provide *qualitative* insights only—no explicit numbers, percentages, money amounts,
     ratios, or dates.
2. For SeniorAnalystGroup
   • Provide precise quantitative details found in the excerpts (figures, growth rates,
     YoY / QoQ changes) and brief comparisons.
3. For PortfolioManagerGroup
   • Provide the same quantitative detail as a senioranalyst **plus** portfolio-action
     guidance (recommended tilts, hedging ideas) that logically follows from the data.
4. For ComplianceOfficerGroup
   • Provide regulatory metrics / thresholds only (e.g., CET1, leverage, LCR).  
   • Do **not** give investment advice.
General formatting
• Answer in 2-5 concise bullet points unless a narrative is essential.
• After each bullet, cite the excerpt ID or page number you used, in parentheses.`,
      userInputEnabled: true,
      shouldPrepareAgent:true
    });


    const actionGroupRole = new iam.Role(this, 'ActionGroupRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for ActionGroupFunction with full admin privileges',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    const actionGroupFunction = new lambda_python.PythonFunction(this, 'ActionGroupFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_handler',
      entry: path.join(__dirname, '../querylogic/action-group'),
      timeout:cdk.Duration.minutes(10),
      environment:{
          KNOWLEDGE_BASE_ID: kb.knowledgeBaseId,
      },
      role: actionGroupRole,  
    });

    const actionGroup = new AgentActionGroup({
      name: 'query-library',
      description: 'Use these functions to get information about the books in the library.',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(actionGroupFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, '../querylogic/action-group/action-group-spec.json')),
    });

    agent.addActionGroup(actionGroup);

    const agentAlias2 = new bedrock.AgentAlias(this, 'myalias2', {
      aliasName: 'my-financialagent-alias',
      agent: agent,
      description: 'alias for my financial agent'
    });

    const backendLambda = new NodejsFunction(this, 'BackendLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      entry: './lambda/index.js', 
      timeout:cdk.Duration.minutes(10),
      role: lambdaRole, // Explicitly connects the role to the Lambda function
      bundling: {
        nodeModules: ['@aws-sdk/client-verifiedpermissions'], // Dependencies to include
        forceDockerBundling: true, // Always use Docker for consistent builds
        dockerImage: lambda.Runtime.NODEJS_20_X.bundlingImage, // Use compatible Docker image
        command: [
          'bash',
          '-c',
          `
            echo "Starting bundling process..."
            echo "Contents of /asset-input (before copying):"
            ls -al /asset-input
            
            # Ensure lambda folder exists in the input
            if [ -d /asset-input/lambda ]; then
              echo "Copying files from /asset-input/lambda to /asset-output..."
              cp -r /asset-input/lambda/* /asset-output/
            else
              echo "Error: /asset-input/lambda does not exist!"
            fi
            
            echo "Contents of /asset-output (after copying):"
            ls -al /asset-output
            
            echo "Running npm install..."
            cd /asset-output
            npm install --no-cache --no-audit
            
            echo "Bundling completed. Final contents of /asset-output:"
            ls -al /asset-output
          `,
        ],
        
        user: 'root', // Run as root to avoid permission issues
        platform: 'linux/amd64', // Match AWS Lambda architecture
      },
      environment: {
        POLICY_STORE_ID: policyStore.attrPolicyStoreId,
        BEDROCK_AGENT_ID:       agent.agentId,
        BEDROCK_AGENT_ALIAS_ID: agentAlias2.aliasId,
      },
    });
    
    
     
    
    
    // Step 6: API Gateway with Cognito Authentication
    const logRole = new iam.Role(this, 'ApiGatewayCloudWatchLogsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });
    
    // Associate the CloudWatch Logs role ARN with API Gateway account settings
    const apiGatewayAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: logRole.roleArn,
    });

    
    // Step 6: API Gateway with Cognito Authentication
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: 'prod', // Explicitly define the stage name (optional)
        loggingLevel: apigateway.MethodLoggingLevel.INFO, // Enable logging
        dataTraceEnabled: true, // Enable detailed request tracing
        metricsEnabled: true, // Enable CloudWatch metrics
      },
    });

    // Add a dependency to ensure the role is set before the API Gateway is deployed
    api.node.addDependency(apiGatewayAccount);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const resource = api.root.addResource('invoke-lambda');
    resource.addMethod('POST', new apigateway.LambdaIntegration(backendLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });


    // Outputs
    new cdk.CfnOutput(this, 'FrontendURL', { value: `https://${distribution.domainName}` });
    new cdk.CfnOutput(this, 'APIEndpoint', { value: `${api.url}invoke-lambda` });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'PolicyStoreId', { value: policyStore.attrPolicyStoreId });
    new cdk.CfnOutput(this, 'VerifiedPermissionsPolicyName', {value: verifiedPermissionsPolicy.policyName});
  }
}
