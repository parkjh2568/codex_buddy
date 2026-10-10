const fs = require('node:fs');
const css = require('css-tree');
const source = fs.readFileSync('src/ui/style.css','utf8');
const errors = [], variables = new Map();
const ast = css.parse(source,{positions:true,parseCustomProperty:true,onParseError:error=>errors.push(error.message)});
css.walk(ast,node=>{if(node.type==='Declaration'&&node.property.startsWith('--'))variables.set(node.property,css.generate(node.value));});
css.walk(ast,{
  visit:'Block',
  enter(block) {
    const seen = new Set();
    for (const node of block.children) {
      if (node.type !== 'Declaration') continue;
      const property = node.property, line = node.loc.start.line;
      if (seen.has(property)) errors.push(`line ${line}: duplicate ${property}`);
      seen.add(property);
      if (property.startsWith('--') || property === '-webkit-app-region') continue;
      let value = css.generate(node.value);
      // Resolve this stylesheet's literal palette/defaults before grammar validation.
      for (let i=0;i<8&&value.includes('var(');i++) value=value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,(_match,name,fallback)=>variables.get(name)??fallback??'var('+name+')');
      if (value.includes('var(')) {errors.push(`line ${line}: unresolved variable in ${property}`);continue;}
      const result = css.lexer.matchProperty(property,value);
      if (result.error) errors.push(`line ${line}: ${property}: ${result.error.message}`);
    }
  }
});
if (errors.length) {console.error(errors.join('\n'));process.exit(1);}
console.log('CSS_SYNTAX_VALUES_AND_DUPLICATES_OK');
