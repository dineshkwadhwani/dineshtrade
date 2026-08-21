const { createClient } = require('@supabase/supabase-js');

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);
  
  const { data, error } = await client
    .from('customer_strategies')
    .select('strategy_key, active, name')
    .eq('customer_id', 'ab6fe725-a279-40ee-954d-58c4a0f6cb4f');
  
  console.log('Strategies in Supabase for your customer:');
  if (error) {
    console.error('Query failed:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  process.exit(0);
})();
