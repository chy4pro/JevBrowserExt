import { validateChoiceAnswer } from '../src/shared/action-space';
import { callOpenRouter } from '../src/shared/providers/openrouter';
import { generateFieldText } from '../src/shared/text-helper';
import { DEFAULT_SETTINGS } from '../src/shared/types';

async function runLiveTests() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('ℹ️  OPENROUTER_API_KEY is not set. Skipping live network tests.');
    process.exit(0);
  }

  console.log('🧪 Starting live end-to-end tests against OpenRouter API...');

  const settings = {
    ...DEFAULT_SETTINGS,
    activeProvider: 'openrouter' as const,
    openrouter: {
      apiKey,
      model: 'typesafe/jev-1.13',
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
    },
    textHelper: {
      provider: 'openrouter' as const,
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
    },
  };

  // Test 1: Real Text Helper returns exactly one JSON field value
  console.log('\n--- 1. Testing Text Helper generation with live OpenRouter API ---');
  const fieldContext = {
    goal: 'Find flights from Zurich to London on September 20',
    field: {
      label: 'Departure Airport',
      role: 'textbox',
      value: '',
    },
    page: {
      title: 'Google Flights',
      text: 'Find cheap airline tickets from Zurich to worldwide destinations',
    },
    recent_actions: [],
  };

  const generated = await generateFieldText(settings, fieldContext);
  console.log('✅ Text Helper successfully generated output:', JSON.stringify(generated));

  // Test 2: Jev Decision API with full state and questions
  console.log('\n--- 2. Testing Jev Decisions API with live OpenRouter API ---');
  const jevRequest = {
    model: 'typesafe/jev-1.13',
    state: {
      page: {
        url: 'https://www.google.com/travel/flights',
        title: 'Google Flights',
        text: 'Where from? Zurich. Where to? London. Search flights.',
      },
      elements: [
        { index: '1', label: 'Departure input', operations: ['TYPE_TEXT'] },
        { index: '2', label: 'Search flights button', operations: ['CLICK'] },
      ],
      recent_actions: [
        { action: 'TYPE_TEXT Departure input', text: 'Zurich' },
      ],
    },
    questions: {
      operation: {
        type: 'choice' as const,
        instructions: 'Choose the next action to find flights',
        criteria: {
          CLICK: 'Click search flights button',
          TYPE_TEXT: 'Type text in destination',
          DONE: 'Already finished',
        },
      },
      click_target: {
        type: 'choice' as const,
        instructions: 'Which element to click?',
        criteria: {
          '2': 'Search flights button',
        },
      },
    },
  };

  const jevRes = await callOpenRouter(settings.openrouter, jevRequest);
  const operation = validateChoiceAnswer(jevRes.answers?.operation, jevRequest.questions.operation.criteria);
  if (operation.choice === 'CLICK') {
    validateChoiceAnswer(jevRes.answers?.click_target, jevRequest.questions.click_target.criteria);
  }
  console.log('✅ Jev API returned a valid decision:');
  console.log('   Model:', jevRes.model);
  console.log('   Operation choice:', JSON.stringify(jevRes.answers?.operation));
  console.log('   Click target choice:', JSON.stringify(jevRes.answers?.click_target));

  console.log('\n🎉 Live E2E checks passed.\n');
}

runLiveTests().catch((err) => {
  console.error('\n❌ LIVE TEST FAILED:', err);
  process.exit(1);
});
