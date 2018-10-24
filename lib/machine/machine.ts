/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    addressEvent,
    buttonForCommand,
    Parameter,
    Parameters,
    QueryNoCacheOptions,
    Success,
} from "@atomist/automation-client";
import {
    AnyPush,
    CommandHandlerRegistration,
    GoalApprovalRequestVote,
    GoalRootType,
    GoalWithFulfillment,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    whenPushSatisfies,
} from "@atomist/sdm";
import { createSoftwareDeliveryMachine } from "@atomist/sdm-core";
import { SlackMessage } from "@atomist/slack-messages";
import * as _ from "lodash";
import {
    SdmGoal,
    SdmGoalState,
} from "../typings/types";

export function machine(
    configuration: SoftwareDeliveryMachineConfiguration,
): SoftwareDeliveryMachine {

    const sdm = createSoftwareDeliveryMachine({
        name: "Deferred Approval Software Delivery Machine",
        configuration,
    });

    const goal = new GoalWithFulfillment({
        uniqueName: "approval-goal",
        preApprovalRequired: true,
    }).with({
        name: "approval-goal-executor",
        goalExecutor: async gi => {
            gi.progressLog.write("No doing much");
            return Success;
        },
    });

    sdm.addGoalContributions(whenPushSatisfies(AnyPush).setGoals(goal));

    sdm.addGoalApprovalRequestVoter(async gi => {
        if (gi.goal.data) {
            const data = JSON.parse(gi.goal.data);
            if (data.foo) {
                return {
                    vote: GoalApprovalRequestVote.Granted,
                };
            }
        }
        
        const msg: SlackMessage = {
            attachments: [{
                text: `Goal '${gi.goal.name}' requires additional input to start`,
                fallback: "Goal requires input",
                actions: [buttonForCommand(
                    { text: "Start" },
                    "PreApprovalCommand",
                    {
                        goalSetId: gi.goal.goalSetId,
                        goalUniqueName: gi.goal.uniqueName,
                        goalState: gi.goal.state,
                    })],
            }],
        };
        await gi.context.messageClient.addressUsers(msg, gi.goal.preApproval.userId);
        return {
            vote: GoalApprovalRequestVote.Abstain,
        };
    });

    sdm.addCommand(PreApprovalCommand);

    return sdm;
}

@Parameters()
class PreApprovalParameters {

    @Parameter({ displayable: false, required: true })
    public goalSetId: string;

    @Parameter({ displayable: false, required: true })
    public goalUniqueName: string;

    @Parameter({ displayable: false, required: true })
    public goalState: SdmGoalState;

    @Parameter({ description: "Some test parameter" })
    public foo: string;

}

const PreApprovalCommand: CommandHandlerRegistration<PreApprovalParameters> = {
    name: "PreApprovalCommand",
    intent: [],
    paramsMaker: PreApprovalParameters,
    listener: async ci => {

        const goal = (await ci.context.graphClient.query<SdmGoal.Query, SdmGoal.Variables>({
            name: "SdmGoal",
            variables: {
                goalSetId: [ci.parameters.goalSetId],
                state: [ci.parameters.goalState],
                uniqueName: [ci.parameters.goalUniqueName],
            },
            options: QueryNoCacheOptions,
        })).SdmGoal[0];

        const updatedGoal = _.cloneDeep(goal);
        updatedGoal.ts = Date.now();
        updatedGoal.data = JSON.stringify({ foo: ci.parameters.foo });

        await ci.context.messageClient.send(updatedGoal, addressEvent(GoalRootType));
    },
};
