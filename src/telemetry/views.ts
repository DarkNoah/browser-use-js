export interface BaseTelemetryEvent {
  name: string;
  properties: Record<string, any>;
}

export abstract class BaseTelemetryEventImpl implements BaseTelemetryEvent {
  abstract get name(): string;

  get properties(): Record<string, any> {
    const props: Record<string, any> = {};
    for (const [key, value] of Object.entries(this)) {
      if (key !== 'name') {
        props[key] = value;
      }
    }
    return props;
  }
}

export interface RegisteredFunction {
  name: string;
  params: Record<string, any>;
}

export class ControllerRegisteredFunctionsTelemetryEvent extends BaseTelemetryEventImpl {
  name = 'controller_registered_functions';

  constructor(public registered_functions: RegisteredFunction[]) {
    super();
  }
}

export class AgentStepTelemetryEvent extends BaseTelemetryEventImpl {
  name = 'agent_step';

  constructor(
    public agentId: string,
    public step: number,
    public stepError: string[],
    public consecutiveFailures: number,
    public actions: Record<string, any>[]
  ) {
    super();
  }
}

export class AgentRunTelemetryEvent extends BaseTelemetryEventImpl {
  name = 'agent_run';

  constructor(
    public agentId: string,
    public useVision: boolean,
    public task: string,
    public modelName?: string,
    public chatModelLibrary?: string,
    public version?: string,
    public source?: string
  ) {
    super();
  }
}

export class AgentEndTelemetryEvent extends BaseTelemetryEventImpl {
  name = 'agent_end';

  constructor(
    public agentId: string,
    public steps: number,
    public maxStepsReached: boolean,
    public success: boolean,
    public errors: string[]
  ) {
    super();
  }
} 