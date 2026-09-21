<script lang="ts">
	import { page } from '$app/state';
	import VModelForm from '$lib/components/VModelForm.svelte';
</script>

<VModelForm vmodelId={page.params.id!} />
